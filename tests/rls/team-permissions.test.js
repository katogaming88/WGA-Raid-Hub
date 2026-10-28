// #1646: the roster, schedule, RSVP, attendance, signup and report checks ask
// the team grid's permission (#1645), so an Assistant can run raids, can't
// make loot decisions, and a permission switched off on a team's grid
// refuses at once.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedMember, seedPlayer, seedSignup, RLS_DENIED } from './helpers.js';

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

const switchOff = (q, teamId, rank, permissions) =>
  q('delete from public.team_rank_permissions where team_id = $1 and rank = $2 and permission = any ($3)', [
    teamId,
    rank,
    permissions
  ]);

const markPresent = (asUser, uid, teamId, playerId, raidDate = '2026-08-01') =>
  asUser(
    uid,
    `insert into public.attendance (team_id, player_id, raid_date, status)
     values ($1, $2, $3, 'Present') returning id`,
    [teamId, playerId, raidDate]
  );

describe('team permissions (#1646)', () => {
  it('an Assistant edits the roster and attendance; a raider, another team and signed out do neither', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const player = await seedPlayer(q, { teamId: team.teamId });

      expect((await renamePlayer(asUser, assistant.uid, player)).rowCount).toBe(1);
      expect((await markPresent(asUser, assistant.uid, team.teamId, player)).rowCount).toBe(1);

      expect((await renamePlayer(asUser, team.raider.uid, player)).rowCount).toBe(0);
      await expect(markPresent(asUser, team.raider.uid, team.teamId, player)).rejects.toMatchObject({
        code: RLS_DENIED
      });

      const other = await seedTeam(q);
      const otherAssistant = await seedAssistant(q, other.teamId);
      expect((await renamePlayer(asUser, otherAssistant.uid, player)).rowCount).toBe(0);
      await expect(markPresent(asUser, otherAssistant.uid, team.teamId, player)).rejects.toMatchObject({
        code: RLS_DENIED
      });

      expect(
        (await asAnon("update public.players set nickname = 'Renamed' where id = $1 returning id", [player])).rowCount
      ).toBe(0);
    });
  });

  it('archiving an Assistant asks Promote Assistants: an Assistant cannot, an Officer can', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const target = await seedAssistant(q, team.teamId);
      const archive = (uid) =>
        asUser(uid, "select public.archive_team_member($1, $2, 'other', null)", [team.teamId, target.memberId]);
      const archived = async () =>
        (await q('select archived_at from public.team_members where id = $1', [target.memberId])).rows[0].archived_at;

      await expect(archive(assistant.uid)).rejects.toThrow(/promote Assistants/);
      expect(await archived()).toBeNull();
      await archive(team.officer.uid);
      expect(await archived()).not.toBeNull();
    });
  });

  it('the audit log takes a row only from a permission that changes something', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const log = () => asUser(assistant.uid, "select public.write_audit_log($1, 'fixture') as id", [team.teamId]);
      expect((await log()).rows[0].id).toBeGreaterThan(0);

      // Left with See RSVPs, View reports and View loot only.
      await switchOff(q, team.teamId, 'assistant', ['edit_roster', 'edit_schedule', 'attendance', 'manage_signups']);
      await expect(log()).rejects.toThrow(/Not authorized/);
    });
  });

  it('adding a signup to the roster asks Edit roster as well as Manage signups', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const signup = await seedSignup(q, { teamId: team.teamId });
      await switchOff(q, team.teamId, 'officer', ['edit_roster']);
      await expect(asUser(team.officer.uid, 'select public.add_signup_to_roster($1)', [signup])).rejects.toThrow(
        /Not authorized/
      );
      expect((await q('select status from public.season_signups where id = $1', [signup])).rows[0].status).toBe(
        'approved'
      );
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

      await switchOff(q, team.teamId, 'officer', ['attendance']);

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
