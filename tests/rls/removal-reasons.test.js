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

  it('an officer writing a reason straight onto the notes row leaves a row too', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
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
