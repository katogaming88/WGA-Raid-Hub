// #1646: the team checks ask the team grid's permission (#1645), so an
// Assistant can run raids and read loot but can't make loot decisions, team
// settings are the Team Owner's, and a permission switched off on a team's
// grid refuses at once.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedTeam,
  seedMember,
  seedPlayer,
  seedSignup,
  grantGuild,
  RLS_DENIED,
  GUILD_OFFICER
} from './helpers.js';

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
      await expect(
        asAnon(
          "insert into public.attendance (team_id, player_id, raid_date, status) values ($1, $2, '2026-08-01', 'Present')",
          [team.teamId, player]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('archiving an Assistant asks Promote Assistants: an Assistant, another team and signed out cannot; an Officer and a guild officer can', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const target = await seedAssistant(q, team.teamId);
      const archive = (uid) =>
        asUser(uid, "select public.archive_team_member($1, $2, 'other', null)", [team.teamId, target.memberId]);
      const archived = async () =>
        (await q('select archived_at from public.team_members where id = $1', [target.memberId])).rows[0].archived_at;

      await expect(archive(assistant.uid)).rejects.toThrow(/promote Assistants/);
      expect(await archived()).toBeNull();
      const other = await seedTeam(q);
      await expect(archive(other.officer.uid)).rejects.toThrow(/Not authorized/);
      await expect(
        asAnon("select public.archive_team_member($1, $2, 'other', null)", [team.teamId, target.memberId])
      ).rejects.toThrow(/permission denied|Not authorized/);
      expect(await archived()).toBeNull();
      await archive(team.officer.uid);
      expect(await archived()).not.toBeNull();

      // A guild officer of the team's guild could archive an Assistant (a
      // raider on the current site) before #1646, and still can.
      const second = await seedAssistant(q, team.teamId);
      await asUser(GUILD_OFFICER, "select public.archive_team_member($1, $2, 'other', null)", [
        team.teamId,
        second.memberId
      ]);
      expect(
        (await q('select archived_at from public.team_members where id = $1', [second.memberId])).rows[0].archived_at
      ).not.toBeNull();
    });
  });

  it('resolve_person shows an Assistant the person but not their BoE Manager grant; an Officer sees both', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const target = await seedMember(q, { teamId: team.teamId });
      await grantGuild(q, target.discordId, 'boe_manager');
      const boeManager = async (uid) =>
        (await asUser(uid, 'select public.resolve_person($1) as p', [target.discordId])).rows[0].p.boe_manager;

      expect(await boeManager(assistant.uid)).toBe(false);
      expect(await boeManager(team.officer.uid)).toBe(true);
    });
  });

  it('an Assistant reads wishlists and BiS requests but cannot act on them or read the audit log', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values ($1, $2, 1, 'bis')", [
        team.teamId,
        player
      ]);
      const request = (
        await q(
          "insert into public.bis_requests (team_id, player_id, bis_link) values ($1, $2, 'https://example.com/t') returning id",
          [team.teamId, player]
        )
      ).rows[0].id;
      await q("insert into public.audit_log (team_id, action) values ($1, 'fixture')", [team.teamId]);
      const count = async (uid, table) =>
        (await asUser(uid, `select count(*)::int as n from public.${table} where team_id = $1`, [team.teamId])).rows[0]
          .n;

      expect(await count(assistant.uid, 'item_preferences')).toBe(1);
      expect(await count(assistant.uid, 'bis_requests')).toBe(1);
      expect(await count(assistant.uid, 'audit_log')).toBe(0);
      expect(await count(team.officer.uid, 'audit_log')).toBeGreaterThan(0);
      expect(await count(team.raider.uid, 'bis_requests')).toBe(0);

      const reject = (uid) =>
        asUser(uid, "update public.bis_requests set status = 'rejected' where id = $1 returning id", [request]);
      expect((await reject(assistant.uid)).rowCount).toBe(0);
      expect((await reject(team.officer.uid)).rowCount).toBe(1);
    });
  });

  it("team settings are the Team Owner's: a second team leader is an Officer by rank", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const coLeader = await seedMember(q, { teamId: team.teamId, role: 'team_leader' });
      expect((await q('select rank from public.team_members where id = $1', [coLeader.memberId])).rows[0].rank).toBe(
        'officer'
      );
      const write = (uid) =>
        asUser(
          uid,
          `update public.team_settings set config = '{"minted": true}' where team_id = $1 returning team_id`,
          [team.teamId]
        );

      expect((await write(coLeader.uid)).rowCount).toBe(0);
      await expect(
        asUser(coLeader.uid, "select public.admin_grant_team_role($1, $2, 'officer')", [
          team.teamId,
          team.raider.discordId
        ])
      ).rejects.toThrow(/Not authorized/);
      expect((await write(team.officer.uid)).rowCount).toBe(0);
      expect((await write(team.leader.uid)).rowCount).toBe(1);
    });
  });

  it("Import loot switched off refuses an Officer's loot writes at once", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const player = await seedPlayer(q, { teamId: team.teamId });
      const writeLoot = (uid) =>
        asUser(
          uid,
          `insert into public.rclc_loot (team_id, player_id, item_id, track, season)
           values ($1, $2, 1, 'Myth', 'seed-season') returning id`,
          [team.teamId, player]
        );
      expect((await writeLoot(team.officer.uid)).rowCount).toBe(1);

      await switchOff(q, team.teamId, 'officer', ['manage_loot']);
      await expect(writeLoot(team.officer.uid)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(team.officer.uid, "select public.import_rclc_loot($1, 'seed-season', '[]'::jsonb)", [team.teamId])
      ).rejects.toThrow(/Not authorized/);
      expect((await writeLoot(team.leader.uid)).rowCount).toBe(1);
    });
  });

  it('Attendance alone reads the lineup it is taken against', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
               values (9001, 99001, 'Test Raid', 'MID2', 0)`);
      await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
               values (9102, 9001, 99102, 'First Boss', 1)`);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await q(
        "insert into public.raid_night_bosses (team_id, raid_date, encounter_id, position) values ($1, '2026-08-01', 9102, 1)",
        [team.teamId]
      );
      await q(
        "insert into public.raid_night_lineups (team_id, raid_date, encounter_id, player_id) values ($1, '2026-08-01', 9102, $2)",
        [team.teamId, player]
      );
      await switchOff(q, team.teamId, 'officer', ['edit_schedule']);
      const visible = async (uid) => {
        const n = async (table) =>
          (await asUser(uid, `select count(*)::int as n from public.${table} where team_id = $1`, [team.teamId]))
            .rows[0].n;
        return [await n('raid_night_bosses'), await n('raid_night_lineups')];
      };

      expect(await visible(team.officer.uid)).toEqual([1, 1]);
      await switchOff(q, team.teamId, 'officer', ['attendance']);
      expect(await visible(team.officer.uid)).toEqual([0, 0]);
    });
  });

  it('the audit log takes a row only from a permission that changes something', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      const assistant = await seedAssistant(q, team.teamId);
      const log = () => asUser(assistant.uid, "select public.write_audit_log($1, 'fixture') as id", [team.teamId]);
      expect((await log()).rows[0].id).toBeGreaterThan(0);

      // Left with See RSVPs, View reports and View loot only.
      await switchOff(q, team.teamId, 'assistant', ['edit_roster', 'edit_schedule', 'attendance', 'manage_signups']);
      await expect(log()).rejects.toThrow(/Not authorized/);

      const other = await seedTeam(q);
      const logAs = (run) => run("select public.write_audit_log($1, 'fixture')", [team.teamId]);
      await expect(logAs((t, p) => asUser(other.officer.uid, t, p))).rejects.toThrow(/Not authorized/);
      await expect(logAs((t, p) => asUser(team.raider.uid, t, p))).rejects.toThrow(/Not authorized/);
      await expect(logAs(asAnon)).rejects.toThrow(/permission denied|Not signed in/);
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
