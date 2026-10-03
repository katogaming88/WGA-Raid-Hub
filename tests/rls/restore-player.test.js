// Behavior tests for restore_player() (#1133): the Roster tab's re-add brings
// an archived character back in one call. It keeps why they left (a removal's
// reason is never lost, #1427), brings back the membership the character is
// linked to (any officer action does, Option 2 on #1355), and keeps whatever
// the form left blank.
//
// Each case mints its own team (seedTeam), so it never writes a seeded row.
// Refusals run on a character linked to nobody, so the function's own gate is
// the only check that answers "Not authorized": restore_team_member() and
// write_audit_log() would refuse the same callers with the same words.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, seedTeam, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

const ARCHIVED = '2026-09-01T00:00:00Z';
const tag = () => randomUUID().replace(/-/g, '').slice(0, 8);

const restore = (asUser, uid, playerId, fields = {}) =>
  asUser(uid, 'select public.restore_player($1, $2, $3, $4, $5, $6) as restored', [
    playerId,
    fields.nameRealm ?? null,
    fields.nickname ?? null,
    fields.classSpecId ?? null,
    fields.isTrial ?? null,
    fields.joinDate ?? null
  ]).then((r) => r.rows[0].restored);

const playerRow = async (q, playerId) =>
  (
    await q(
      `select name_realm, nickname, class_spec_id, is_trial, is_bench, join_date::text as join_date,
              archived_at, team_member_id
         from public.players where id = $1`,
      [playerId]
    )
  ).rows[0];

const auditFor = async (q, teamId) =>
  (
    await q(
      `select action, target_type, target_id, detail from public.audit_log
        where team_id = $1 and action in ('Player Added', 'team_member_restored') order by id`,
      [teamId]
    )
  ).rows;

// The seed holds one spec (id 1), so the second is minted for the case.
const twoSpecs = async (q) => {
  const { rows } = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', $1, 'Melee') returning id",
    [`Spec${tag()}`]
  );
  return [1, rows[0].id];
};

const specLabel = async (q, id) =>
  (await q("select concat_ws(' ', class, spec, role) as label from public.classes_specs where id = $1", [id])).rows[0]
    .label;

// Someone with a guild-wide grant and no membership on the team.
const seedGrant = async (q, grantType) => {
  const uid = randomUUID();
  const discordId = `fixture-${randomUUID()}`;
  await insertDiscordUser(q, uid, discordId);
  await grantGuild(q, discordId, grantType);
  return uid;
};

const archiveMember = (asUser, uid, teamId, memberId) =>
  asUser(uid, 'select public.archive_team_member($1, $2, $3, $4)', [teamId, memberId, 'moved_guilds', 'Left']);

describe('restore_player() brings a character back', () => {
  it("an officer brings one back with the form's values, and the audit log says so", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const [first, second] = await twoSpecs(q);
      const name = `Readd${tag()}`;
      const playerId = await seedPlayer(q, {
        memberId: team.raider.memberId,
        nameRealm: `${name}-Area 52`,
        classSpecId: first,
        archivedAt: ARCHIVED
      });
      await q(
        "update public.players set nickname = 'Old', is_bench = true, is_trial = false, join_date = '2026-01-05' where id = $1",
        [playerId]
      );
      // Only the spelling of the name changes: same character, same key.
      const restored = await restore(asUser, team.officer.uid, playerId, {
        nameRealm: `${name.toUpperCase()}-Area52`,
        nickname: 'New',
        classSpecId: second,
        isTrial: true,
        joinDate: '2026-10-01'
      });
      expect(restored).toBe(false);
      expect(await playerRow(q, playerId)).toEqual({
        name_realm: `${name.toUpperCase()}-Area52`,
        nickname: 'New',
        class_spec_id: second,
        is_trial: true,
        is_bench: false,
        join_date: '2026-10-01',
        archived_at: null,
        team_member_id: team.raider.memberId
      });
      expect(await auditFor(q, team.teamId)).toEqual([
        {
          action: 'Player Added',
          target_type: 'players',
          target_id: playerId,
          detail: `${await specLabel(q, second)}, re-added`
        }
      ]);
    });
  });

  it('a field left blank keeps what the character had', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const [, second] = await twoSpecs(q);
      const nameRealm = `Keep${tag()}-Illidan`;
      const playerId = await seedPlayer(q, {
        teamId: team.teamId,
        nameRealm,
        classSpecId: second,
        archivedAt: ARCHIVED
      });
      await q(
        "update public.players set nickname = 'Kept', is_bench = true, is_trial = true, join_date = '2026-02-02' where id = $1",
        [playerId]
      );
      await restore(asUser, team.officer.uid, playerId, { nameRealm: '', nickname: '' });
      expect(await playerRow(q, playerId)).toEqual({
        name_realm: nameRealm,
        nickname: 'Kept',
        class_spec_id: second,
        is_trial: true,
        is_bench: false,
        join_date: '2026-02-02',
        archived_at: null,
        team_member_id: null
      });
    });
  });

  it('brings an archived membership back with it, as a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      expect(await restore(asUser, team.officer.uid, playerId)).toBe(true);
      const member = (
        await q('select role, archived_at from public.team_members where id = $1', [team.raider.memberId])
      ).rows[0];
      expect(member).toEqual({ role: 'raider', archived_at: null });
      expect((await playerRow(q, playerId)).archived_at).toBeNull();
      expect(await auditFor(q, team.teamId)).toEqual([
        {
          action: 'team_member_restored',
          target_type: 'team_member',
          target_id: team.raider.memberId,
          detail: { role: 'raider', archived_role: 'raider' }
        },
        {
          action: 'Player Added',
          target_type: 'players',
          target_id: playerId,
          detail: `${await specLabel(q, 1)}, re-added, membership restored`
        }
      ]);
    });
  });

  it('brings back a character linked to nobody', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      expect(await restore(asUser, team.officer.uid, playerId)).toBe(false);
      const row = await playerRow(q, playerId);
      expect([row.archived_at, row.team_member_id]).toEqual([null, null]);
    });
  });

  // restore_team_member() is asked about every linked character, current
  // membership or not, because it is what locks the membership; it refuses a
  // membership on another team whatever that membership's state.
  it("refuses a character linked to another team's membership, and changes nothing", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await seedPlayer(q, {
        teamId: team.teamId,
        memberId: other.raider.memberId,
        archivedAt: ARCHIVED
      });
      await expect(restore(asUser, team.officer.uid, playerId)).rejects.toThrow(/not on this team/);
      expect((await playerRow(q, playerId)).archived_at).not.toBeNull();
    });
  });

  it('refuses a character already on the roster, and changes nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await q("update public.players set nickname = 'Here' where id = $1", [playerId]);
      await expect(restore(asUser, team.officer.uid, playerId, { nickname: 'Other' })).rejects.toThrow(
        /already on the roster/
      );
      expect((await playerRow(q, playerId)).nickname).toBe('Here');
    });
  });

  it('refuses a name that is not this character, and changes nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameRealm = `Mine${tag()}-Illidan`;
      const playerId = await seedPlayer(q, { teamId: team.teamId, nameRealm, archivedAt: ARCHIVED });
      await expect(
        restore(asUser, team.officer.uid, playerId, { nameRealm: `Someone${tag()}-Illidan` })
      ).rejects.toThrow(/not this character/);
      const row = await playerRow(q, playerId);
      expect([row.name_realm, row.archived_at === null]).toEqual([nameRealm, false]);
    });
  });
});

describe('who may call restore_player()', () => {
  it("the team's officer and its leader", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const byOfficer = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      const byLeader = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await restore(asUser, team.officer.uid, byOfficer);
      await restore(asUser, team.leader.uid, byLeader);
      expect((await playerRow(q, byOfficer)).archived_at).toBeNull();
      expect((await playerRow(q, byLeader)).archived_at).toBeNull();
    });
  });

  it('a guild officer and a site admin, from outside the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const guildOfficer = await seedGrant(q, 'guild_officer');
      const admin = await seedGrant(q, 'site_admin');
      const byGuildOfficer = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      const byAdmin = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await restore(asUser, guildOfficer, byGuildOfficer);
      await restore(asUser, admin, byAdmin);
      expect((await playerRow(q, byGuildOfficer)).archived_at).toBeNull();
      expect((await playerRow(q, byAdmin)).archived_at).toBeNull();
    });
  });

  it('not a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await expect(restore(asUser, team.raider.uid, playerId)).rejects.toThrow(/Not authorized/);
      expect((await playerRow(q, playerId)).archived_at).not.toBeNull();
    });
  });

  it("not another team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await expect(restore(asUser, other.officer.uid, playerId)).rejects.toThrow(/Not authorized/);
      expect((await playerRow(q, playerId)).archived_at).not.toBeNull();
    });
  });

  it('not an officer once their own membership is archived', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const before = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      const after = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await restore(asUser, team.officer.uid, before);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      await expect(restore(asUser, team.officer.uid, after)).rejects.toThrow(/Not authorized/);
      expect((await playerRow(q, after)).archived_at).not.toBeNull();
    });
  });

  it('not a signed-out visitor', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await expect(
        asAnon('select public.restore_player($1, $2, $3, $4, $5, $6)', [playerId, null, null, null, null, null])
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('restore_player() keeps why they left', () => {
  it('leaves the notes row and every removal reason as they were', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asUser(
        team.officer.uid,
        "insert into public.player_officer_notes (player_id, team_id, officer_notes) values ($1, $2, 'Watch the pulls')",
        [playerId, team.teamId]
      );
      await asUser(team.officer.uid, 'select public.archive_player($1, $2, $3)', [
        playerId,
        'performance',
        'Missed mechanics'
      ]);
      await restore(asUser, team.officer.uid, playerId);
      const notes = (
        await q(
          `select officer_notes, archived_reason, archived_reason_detail
             from public.player_officer_notes where player_id = $1`,
          [playerId]
        )
      ).rows;
      expect(notes).toEqual([
        { officer_notes: 'Watch the pulls', archived_reason: 'performance', archived_reason_detail: 'Missed mechanics' }
      ]);
      const reasons = (await q('select reason, detail from public.removal_reasons where player_id = $1', [playerId]))
        .rows;
      expect(reasons).toEqual([{ reason: 'performance', detail: 'Missed mechanics' }]);
    });
  });

  it('does not create a notes row for a character that had none', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await restore(asUser, team.officer.uid, playerId);
      const { rows } = await q('select count(*)::int as n from public.player_officer_notes where player_id = $1', [
        playerId
      ]);
      expect(rows[0].n).toBe(0);
    });
  });

  // A test transaction's now() never moves, so the first removal is dated
  // before it; two archives in one transaction would share a date and the
  // second row would be skipped as a repeat of the first.
  it('a second removal for the same reason after a re-add is kept as a row of its own', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId, archivedAt: ARCHIVED });
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'other', 'Left')`,
        [playerId, team.teamId]
      );
      await restore(asUser, team.officer.uid, playerId);
      await asUser(team.officer.uid, 'select public.archive_player($1, $2, $3)', [playerId, 'other', 'Left']);
      const { rows } = await q(
        'select reason, detail, removed_at from public.removal_reasons where player_id = $1 order by removed_at',
        [playerId]
      );
      expect(rows.map((r) => [r.reason, r.detail])).toEqual([
        ['other', 'Left'],
        ['other', 'Left']
      ]);
      expect(rows[0].removed_at.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(rows[1].removed_at.toISOString()).not.toBe('2026-09-01T00:00:00.000Z');
    });
  });
});
