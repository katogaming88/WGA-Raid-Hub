// Behavior tests for removal_reasons (#1427): every reason a character or a
// membership was removed for is kept, one row each, and nothing rewrites or
// deletes a row. The notes row keeps only the latest reason; a re-add used to
// clear it and a later removal overwrote it.
//
// Each case mints its own team (seedTeam), so it never writes a seeded row.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, seedTeam, seedPlayer, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const archivePlayer = (asUser, uid, playerId, reason = 'moved_guilds', detail = 'Joined another guild') =>
  asUser(uid, 'select public.archive_player($1, $2, $3)', [playerId, reason, detail]);

const archiveMember = (asUser, uid, teamId, memberId, reason = 'schedule_conflict', detail = 'New job') =>
  asUser(uid, 'select public.archive_team_member($1, $2, $3, $4)', [teamId, memberId, reason, detail]);

const rowsFor = async (q, teamId) =>
  (
    await q(
      `select player_id, team_member_id, reason, detail, removed_by
         from public.removal_reasons where team_id = $1 order by id`,
      [teamId]
    )
  ).rows;

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

describe('removal_reasons gets a row for every reason written', () => {
  it("archive_player() leaves the character's reason, its membership and who removed it", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      expect(await rowsFor(q, team.teamId)).toEqual([
        {
          player_id: playerId,
          team_member_id: team.raider.memberId,
          reason: 'moved_guilds',
          detail: 'Joined another guild',
          removed_by: await personOf(q, team.officer.uid)
        }
      ]);
    });
  });

  it('archive_team_member() leaves one row for the membership and one per character it archives', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const first = await seedPlayer(q, { memberId: team.raider.memberId });
      const second = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const rows = await rowsFor(q, team.teamId);
      expect(rows.map((r) => [r.player_id, r.team_member_id, r.reason, r.detail])).toEqual(
        expect.arrayContaining([
          [null, team.raider.memberId, 'schedule_conflict', 'New job'],
          [first, team.raider.memberId, 'schedule_conflict', 'New job'],
          [second, team.raider.memberId, 'schedule_conflict', 'New job']
        ])
      );
      expect(rows).toHaveLength(3);
    });
  });

  it('archive_team_member() on a member with no characters leaves the membership row alone', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      expect(await rowsFor(q, team.teamId)).toEqual([
        {
          player_id: null,
          team_member_id: team.raider.memberId,
          reason: 'schedule_conflict',
          detail: 'New job',
          removed_by: await personOf(q, team.officer.uid)
        }
      ]);
    });
  });

  it('an officer removing a character by hand and writing the reason onto the notes row leaves a row too', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asUser(team.officer.uid, 'update public.players set archived_at = now() where id = $1', [playerId]);
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'drama', 'Written by hand')`,
        [playerId, team.teamId]
      );
      const rows = await rowsFor(q, team.teamId);
      expect(rows.map((r) => [r.player_id, r.reason, r.detail])).toEqual([[playerId, 'drama', 'Written by hand']]);
    });
  });

  // A test transaction's now() never moves, so the removal is dated before it:
  // only a row dated from players.archived_at can match.
  it('the row is dated at the removal itself, not when the reason was written', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asUser(team.officer.uid, "update public.players set archived_at = '2026-09-01T00:00:00Z' where id = $1", [
        playerId
      ]);
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'other', 'Left')`,
        [playerId, team.teamId]
      );
      const { rows } = await q('select removed_at from public.removal_reasons where player_id = $1', [playerId]);
      expect(rows.map((r) => r.removed_at.toISOString())).toEqual(['2026-09-01T00:00:00.000Z']);
    });
  });

  // Nobody was removed, so there is nothing to keep: the officer page never
  // does this, and a stray write must not leave a permanent false record.
  it('a reason written onto a character still on the roster is not a removal', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'drama', 'Written by hand')`,
        [playerId, team.teamId]
      );
      expect(await rowsFor(q, team.teamId)).toEqual([]);
    });
  });

  it('writing the same reason again adds nothing, and a correction is kept under the same removal', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      // Removed before this transaction began, so a correction written now
      // only lands under the same removal if rows are dated by the removal.
      await asUser(team.officer.uid, "update public.players set archived_at = '2026-09-01T00:00:00Z' where id = $1", [
        playerId
      ]);
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'other', 'Left')`,
        [playerId, team.teamId]
      );
      await asUser(
        team.officer.uid,
        "update public.player_officer_notes set archived_reason = 'other', archived_reason_detail = 'Left' where player_id = $1",
        [playerId]
      );
      expect(await rowsFor(q, team.teamId)).toHaveLength(1);
      await asUser(
        team.officer.uid,
        "update public.player_officer_notes set archived_reason_detail = 'Left for another guild' where player_id = $1",
        [playerId]
      );
      const { rows } = await q(
        `select detail, count(*) over (partition by removed_at)::int as same_removal
           from public.removal_reasons where player_id = $1 order by id`,
        [playerId]
      );
      expect(rows).toEqual([
        { detail: 'Left', same_removal: 2 },
        { detail: 'Left for another guild', same_removal: 2 }
      ]);
    });
  });

  it('removed, brought back with the reason cleared, then removed again: both reasons stay', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId, 'other', 'First time');
      // Today's re-add on the Roster tab: un-archive, then clear the reason.
      await asUser(team.officer.uid, 'update public.players set archived_at = null where id = $1', [playerId]);
      await asUser(
        team.officer.uid,
        'update public.player_officer_notes set archived_reason = null, archived_reason_detail = null where player_id = $1',
        [playerId]
      );
      await archivePlayer(asUser, team.officer.uid, playerId, 'performance', 'Second time');
      const rows = await rowsFor(q, team.teamId);
      expect(rows.map((r) => [r.reason, r.detail])).toEqual([
        ['other', 'First time'],
        ['performance', 'Second time']
      ]);
    });
  });

  it('clearing the reason of a character still removed goes through and writes no row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      await asUser(
        team.officer.uid,
        'update public.player_officer_notes set archived_reason = null, archived_reason_detail = null where player_id = $1',
        [playerId]
      );
      expect((await rowsFor(q, team.teamId)).map((r) => r.detail)).toEqual(['Joined another guild']);
    });
  });

  it('saving an officer note, or clearing a reason, writes no row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await asUser(
        team.officer.uid,
        `insert into public.player_officer_notes (player_id, team_id, officer_notes) values ($1, $2, 'Good healer')
         on conflict (player_id) do update set officer_notes = excluded.officer_notes`,
        [playerId, team.teamId]
      );
      await asUser(
        team.officer.uid,
        'update public.player_officer_notes set archived_reason = null, archived_reason_detail = null where player_id = $1',
        [playerId]
      );
      expect(await rowsFor(q, team.teamId)).toEqual([]);
    });
  });
});

describe('who can read and write removal_reasons', () => {
  it("the team's officer reads its rows; another team's officer, a raider and a signed-out visitor read none", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      const count = async (run) =>
        (await run('select count(*)::int as n from public.removal_reasons where team_id = $1', [team.teamId])).rows[0]
          .n;
      expect(await count((t, p) => asUser(team.officer.uid, t, p))).toBe(1);
      expect(await count((t, p) => asUser(other.officer.uid, t, p))).toBe(0);
      expect(await count((t, p) => asUser(team.raider.uid, t, p))).toBe(0);
      expect(await count((t, p) => asAnon(t, p))).toBe(0);
    });
  });

  it('a guild officer and a site admin read them too', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      for (const grant of ['guild_officer', 'site_admin']) {
        const uid = randomUUID();
        const discordId = `fixture-${randomUUID()}`;
        await insertDiscordUser(q, uid, discordId);
        await grantGuild(q, discordId, grant);
        const seen = await asUser(uid, 'select count(*)::int as n from public.removal_reasons where team_id = $1', [
          team.teamId
        ]);
        expect(seen.rows[0].n).toBe(1);
      }
    });
  });

  it('nobody inserts, updates or deletes a row directly', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      await expect(
        asUser(
          team.officer.uid,
          "insert into public.removal_reasons (team_id, player_id, reason) values ($1, $2, 'other')",
          [team.teamId, playerId]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(team.officer.uid, "update public.removal_reasons set detail = 'changed' where team_id = $1", [
          team.teamId
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(team.officer.uid, 'delete from public.removal_reasons where team_id = $1', [team.teamId])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      expect((await rowsFor(q, team.teamId)).map((r) => r.detail)).toEqual(['Joined another guild']);
    });
  });

  it('the service role cannot update, delete or empty it either', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      const asService = asRole('service_role', null);
      await expect(
        asService("update public.removal_reasons set detail = 'changed' where team_id = $1", [team.teamId])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asService('delete from public.removal_reasons where team_id = $1', [team.teamId])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asService('truncate public.removal_reasons')).rejects.toMatchObject({ code: RLS_DENIED });
      expect(await rowsFor(q, team.teamId)).toHaveLength(1);
    });
  });
});

describe('removal_reasons keeps its rows whole', () => {
  it("refuses a row filed under another team than its character's", async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await expect(
        q("insert into public.removal_reasons (team_id, player_id, reason) values ($1, $2, 'other')", [
          other.teamId,
          playerId
        ])
      ).rejects.toThrow(/does not match players.team_id/);
    });
  });

  it("refuses a membership's row filed under another team than the membership's", async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      await expect(
        q("insert into public.removal_reasons (team_id, team_member_id, reason) values ($1, $2, 'other')", [
          other.teamId,
          team.raider.memberId
        ])
      ).rejects.toThrow(/does not match team_members.team_id/);
    });
  });

  // admin_revoke_team_role() deletes a membership no character points at; once
  // a reason points at it, it demotes instead, as it does for a character.
  it('revoking the role of someone with a reason on record demotes them rather than failing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.officer.memberId });
      await archivePlayer(asUser, team.leader.uid, playerId);
      await q('update public.players set team_member_id = null where id = $1', [playerId]);
      await asUser(team.leader.uid, 'select public.admin_revoke_team_role($1, $2)', [
        team.teamId,
        team.officer.discordId
      ]);
      const member = (await q('select role from public.team_members where id = $1', [team.officer.memberId])).rows;
      expect(member).toEqual([{ role: 'raider' }]);
    });
  });

  it('refuses a row about neither a character nor a membership', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      await expect(
        q("insert into public.removal_reasons (team_id, reason) values ($1, 'other')", [team.teamId])
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('refuses deleting a character on its own once it has a reason on record', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, {
        teamId: team.teamId,
        nameRealm: `Gone${randomUUID().slice(0, 6)}-Illidan`
      });
      await archivePlayer(asUser, team.officer.uid, playerId);
      await expect(q('delete from public.players where id = $1', [playerId])).rejects.toMatchObject({ code: '23503' });
    });
  });
});
