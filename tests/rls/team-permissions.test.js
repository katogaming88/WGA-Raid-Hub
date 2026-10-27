// #1646: the roster, schedule, RSVP, attendance, signup and report checks ask
// the team grid's permission (#1645), so an Assistant can run raids, can't
// make loot decisions, and a permission switched off on a team's grid
// refuses at once.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedMember, seedPlayer, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

// A rank is changed only through functions (team_members_guard_rank), so the
// fixture sets it as the table owner.
async function seedAssistant(q, teamId) {
  const assistant = await seedMember(q, { teamId });
  await q("update public.team_members set rank = 'assistant' where id = $1", [assistant.memberId]);
  return assistant;
}

const renamePlayer = (asUser, uid, playerId) =>
  asUser(uid, "update public.players set nickname = 'Renamed' where id = $1 returning id", [playerId]);

const markPresent = (asUser, uid, teamId, playerId, raidDate = '2026-08-01') =>
  asUser(
    uid,
    `insert into public.attendance (team_id, player_id, raid_date, status)
     values ($1, $2, $3, 'Present') returning id`,
    [teamId, playerId, raidDate]
  );

describe('team permissions (#1646)', () => {
  it('an Assistant edits the roster and attendance; a raider does neither', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const player = await seedPlayer(q, { teamId: team.teamId });

      expect((await renamePlayer(asUser, assistant.uid, player)).rowCount).toBe(1);
      expect((await markPresent(asUser, assistant.uid, team.teamId, player)).rowCount).toBe(1);

      expect((await renamePlayer(asUser, team.raider.uid, player)).rowCount).toBe(0);
      await expect(markPresent(asUser, team.raider.uid, team.teamId, player)).rejects.toMatchObject({
        code: RLS_DENIED
      });
    });
  });

  it('an Assistant cannot import loot or edit priority', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const player = await seedPlayer(q, { teamId: team.teamId });

      await expect(
        asUser(
          assistant.uid,
          `insert into public.rclc_loot (team_id, player_id, item_id, track, season)
           values ($1, $2, 1, 'Myth', 'seed-season')`,
          [team.teamId, player]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(assistant.uid, "select public.import_rclc_loot($1, 'seed-season', '[]'::jsonb)", [team.teamId])
      ).rejects.toThrow(/Not authorized/);
      await expect(
        asUser(assistant.uid, "select public.save_priority_order($1, 'seed-season', 1, 'Myth', '[]'::jsonb)", [
          team.teamId
        ])
      ).rejects.toThrow(/Not authorized/);
    });
  });

  it('a permission switched off on the grid refuses at once, on that team only', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const player = await seedPlayer(q, { teamId: team.teamId });
      expect((await markPresent(asUser, team.officer.uid, team.teamId, player)).rowCount).toBe(1);

      await q(
        `delete from public.team_rank_permissions
          where team_id = $1 and rank = 'officer' and permission = 'attendance'`,
        [team.teamId]
      );

      await expect(markPresent(asUser, team.officer.uid, team.teamId, player)).rejects.toMatchObject({
        code: RLS_DENIED
      });
      await expect(
        asUser(team.officer.uid, 'select public.record_raid_night_participation($1, $2, 1, $3)', [
          team.teamId,
          '2026-08-01',
          [player]
        ])
      ).rejects.toThrow(/Not authorized/);
      // The owner holds every permission whatever the grid says.
      expect((await markPresent(asUser, team.leader.uid, team.teamId, player, '2026-08-08')).rowCount).toBe(1);
      const otherOfficer = await asUser(
        other.officer.uid,
        "select public.has_team_permission($1, 'attendance') as ok",
        [other.teamId]
      );
      expect(otherOfficer.rows[0].ok).toBe(true);
    });
  });
});
