// #1712: a team's Discord settings, read and changed by its officers through
// functions, with the old bot's columns kept in step.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, OFFICER_T1, OFFICER_T2, RAIDER_T1, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const SERVER = '100000000000000001';
const OTHER_SERVER = '100000000000000002';
const CH_OFFICERS = '200000000000000001';
const CH_RSVPS = '200000000000000002';
const CH_TUESDAY = '200000000000000003';
const ROLE_OFFICER = '300000000000000001';
const ROLE_MPLUS = '300000000000000002';

const settings = async (asUser, uid, team = 1) =>
  (await asUser(uid, 'select public.team_discord_settings($1) as s', [team])).rows[0].s;
const config = async (q, team = 1) =>
  (await q('select * from public.team_discord_config where team_id = $1', [team])).rows[0];
const audits = async (q, team = 1) =>
  (
    await q("select action from public.audit_log where team_id = $1 and action like 'Discord %' order by id", [team])
  ).rows.map((r) => r.action);
const sheet = (
  asUser,
  uid,
  { id = null, channel = CH_TUESDAY, days = [2], keep = 2, hours = null, role = null } = {}
) =>
  asUser(uid, 'select public.save_team_discord_signup_sheet(1, $1, $2, $3, $4, $5, $6) as id', [
    id,
    channel,
    days,
    keep,
    hours,
    role
  ]);

// Both test officers were found sharing both servers with the bot, as the
// function that reads Discord (#994) records it.
const verify = (q, uid, server, at = 'now()') =>
  q(
    `insert into public.discord_server_access (person_id, server_id, verified_at)
     select id, $2, ${at} from public.people where auth_user_id = $1
     on conflict (person_id, server_id) do update set verified_at = excluded.verified_at`,
    [uid, server]
  );
const txn = (fn) =>
  withTxn(async (ctx) => {
    for (const uid of [OFFICER_T1, OFFICER_T2])
      for (const server of [SERVER, OTHER_SERVER]) await verify(ctx.q, uid, server);
    return fn(ctx);
  });

describe('team Discord settings', () => {
  it("an Officer reads and changes every setting, and each change lands in the team's audit log once", async () => {
    await txn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'officer_requests', $1, $2)", [
        CH_OFFICERS,
        ROLE_OFFICER
      ]);
      const id = (await sheet(asUser, OFFICER_T1, { days: [2, 2] })).rows[0].id;
      await asUser(OFFICER_T1, "select public.set_team_discord_quiet_hours(1, '00:00', '08:00', 'America/New_York')");

      const s = await settings(asUser, OFFICER_T1);
      expect(s.server_id).toBe(SERVER);
      expect(s.quiet_hours).toEqual({ start: '00:00:00', end: '08:00:00', timezone: 'America/New_York' });
      expect(s.posts.map((p) => p.kind)).toEqual(['officer_requests', 'mplus_requests', 'rsvp_changes']);
      expect(s.posts[0]).toMatchObject({ channel_id: CH_OFFICERS, ping_role_id: ROLE_OFFICER });
      expect(s.posts[2]).toMatchObject({ channel_id: null, ping_role_id: null });
      expect(s.sheets).toEqual([
        expect.objectContaining({ id, channel_id: CH_TUESDAY, raid_days: [2], keep_raids_posted: 2 })
      ]);

      // Saving the same values again changes nothing and logs nothing.
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'officer_requests', $1, $2)", [
        CH_OFFICERS,
        ROLE_OFFICER
      ]);
      await sheet(asUser, OFFICER_T1, { id });
      await asUser(OFFICER_T1, "select public.set_team_discord_quiet_hours(1, '00:00', '08:00', 'America/New_York')");
      expect(await audits(q)).toEqual([
        'Discord Server Set',
        'Discord Post Set',
        'Discord Signup Sheet Saved',
        'Discord Quiet Hours Set'
      ]);

      await asUser(OFFICER_T1, 'select public.remove_team_discord_signup_sheet(1, $1)', [id]);
      await asUser(OFFICER_T1, 'select public.set_team_discord_quiet_hours(1, null, null, null)');
      const after = await settings(asUser, OFFICER_T1);
      expect(after.sheets).toEqual([]);
      expect(after.quiet_hours).toBeNull();
    });
  });

  it("refuses raiders, another team's officers and signed-out visitors", async () => {
    await txn(async ({ asUser, asAnon }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      const calls = [
        ['select public.team_discord_settings(1)', []],
        ['select public.set_team_discord_server(1, $1)', [OTHER_SERVER]],
        ["select public.set_team_discord_post(1, 'rsvp_changes', $1, null)", [CH_RSVPS]],
        ['select public.save_team_discord_signup_sheet(1, null, $1, $2, 2, null, null)', [CH_TUESDAY, [2]]],
        ['select public.remove_team_discord_signup_sheet(1, 1)', []],
        ["select public.set_team_discord_quiet_hours(1, '00:00', '08:00', 'UTC')", []]
      ];
      for (const [sql, params] of calls) {
        await expect(asUser(RAIDER_T1, sql, params)).rejects.toThrow(/Not authorized/);
        await expect(asUser(OFFICER_T2, sql, params)).rejects.toThrow(/Not authorized/);
        await expect(asAnon(sql, params)).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("goes by the rank grid: an Officer has it, and taking it off a team's Officers locks them out", async () => {
    await txn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect(
        (await asUser(team.officer.uid, 'select public.team_discord_settings($1) as s', [team.teamId])).rows[0].s
      ).toMatchObject({ server_id: null, sheets: [] });
      await q(
        "delete from public.team_rank_permissions where team_id = $1 and permission = 'change_discord_settings'",
        [team.teamId]
      );
      await expect(asUser(team.officer.uid, 'select public.team_discord_settings($1)', [team.teamId])).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it("refuses a raid day another sheet already has, naming that sheet's channel", async () => {
    await txn(async ({ asUser }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      const id = (await sheet(asUser, OFFICER_T1, { days: [2] })).rows[0].id;
      const err = await sheet(asUser, OFFICER_T1, { channel: CH_RSVPS, days: [4, 2], keep: null, hours: 12 }).catch(
        (e) => e
      );
      expect(err.message).toBe('Tuesday is already on another signup sheet');
      expect(err.detail).toBe(CH_TUESDAY);
      // The sheet's own days are not a clash when it is changed.
      await sheet(asUser, OFFICER_T1, { id, days: [2, 3] });
      await sheet(asUser, OFFICER_T1, { channel: CH_RSVPS, days: [4], keep: null, hours: 12 });
    });
  });

  it('refuses a malformed setting before saving anything', async () => {
    await txn(async ({ asUser }) => {
      await expect(
        asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'rsvp_changes', $1, null)", [CH_RSVPS])
      ).rejects.toThrow(/server first/);
      await expect(asUser(OFFICER_T1, "select public.set_team_discord_server(1, 'we-go-again')")).rejects.toThrow(
        /not a Discord server id/
      );
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      await expect(
        asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'nope', $1, null)", [CH_RSVPS])
      ).rejects.toThrow(/not a kind of post/);
      await expect(
        asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'rsvp_changes', null, $1)", [ROLE_OFFICER])
      ).rejects.toThrow(/channel before a role/);
      await expect(sheet(asUser, OFFICER_T1, { keep: 2, hours: 12 })).rejects.toThrow(/one of the two/);
      await expect(sheet(asUser, OFFICER_T1, { keep: 5 })).rejects.toThrow(/1 to 4/);
      await expect(sheet(asUser, OFFICER_T1, { days: [] })).rejects.toThrow(/at least one raid day/);
      await expect(sheet(asUser, OFFICER_T1, { days: [7] })).rejects.toThrow(/at least one raid day/);
      await expect(
        asUser(OFFICER_T1, "select public.set_team_discord_quiet_hours(1, '00:00', null, 'UTC')")
      ).rejects.toThrow(/or none of them/);
      await expect(
        asUser(OFFICER_T1, "select public.set_team_discord_quiet_hours(1, '00:00', '08:00', 'Mars/Base')")
      ).rejects.toThrow(/not a time zone/);
    });
  });

  it("saving the three kinds of post keeps the old bot's columns in step", async () => {
    await txn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'officer_requests', $1, $2)", [
        CH_OFFICERS,
        ROLE_OFFICER
      ]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'mplus_requests', $1, $2)", [
        CH_OFFICERS,
        ROLE_MPLUS
      ]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'rsvp_changes', $1, null)", [CH_RSVPS]);
      expect(await config(q)).toMatchObject({
        officer_channel_id: CH_OFFICERS,
        roster_ping_role_id: ROLE_OFFICER,
        mplus_ping_role_id: ROLE_MPLUS,
        attendance_channel_id: CH_RSVPS,
        rsvp_ping_role_id: null
      });
      // Officer requests off: the old bot keeps its officer channel, unpinged.
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'officer_requests', null, null)");
      expect(await config(q)).toMatchObject({ officer_channel_id: CH_OFFICERS, roster_ping_role_id: null });
    });
  });

  it('two teams may share a channel now', async () => {
    await txn(async ({ asUser }) => {
      for (const [uid, team] of [
        [OFFICER_T1, 1],
        [OFFICER_T2, 2]
      ]) {
        await asUser(uid, 'select public.set_team_discord_server($1, $2)', [team, SERVER]);
        await asUser(uid, "select public.set_team_discord_post($1, 'rsvp_changes', $2, null)", [team, CH_RSVPS]);
      }
    });
  });

  it("changing the server clears every post's channel and removes the sheets", async () => {
    await txn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      await asUser(OFFICER_T1, "select public.set_team_discord_post(1, 'officer_requests', $1, $2)", [
        CH_OFFICERS,
        ROLE_OFFICER
      ]);
      await sheet(asUser, OFFICER_T1);
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [OTHER_SERVER]);

      const s = await settings(asUser, OFFICER_T1);
      expect(s.server_id).toBe(OTHER_SERVER);
      expect(s.posts.every((p) => p.channel_id === null && p.ping_role_id === null)).toBe(true);
      expect(s.sheets).toEqual([]);
      expect(await config(q)).toMatchObject({ officer_channel_id: null, roster_ping_role_id: null });
    });
  });

  it('takes only a server the caller was found sharing with the bot in the last hour', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER])).rejects.toThrow(
        /you and the bot are both in/
      );
      // Someone else's check does not count for the caller.
      await verify(q, OFFICER_T2, SERVER);
      await expect(asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER])).rejects.toThrow(
        /you and the bot are both in/
      );
      await verify(q, OFFICER_T1, SERVER, "now() - interval '2 hours'");
      await expect(asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER])).rejects.toThrow(
        /you and the bot are both in/
      );
      await verify(q, OFFICER_T1, SERVER);
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
    });
  });

  it("refuses changing or removing another team's sheet by its id", async () => {
    await txn(async ({ asUser }) => {
      await asUser(OFFICER_T1, 'select public.set_team_discord_server(1, $1)', [SERVER]);
      const id = (await sheet(asUser, OFFICER_T1)).rows[0].id;
      await asUser(OFFICER_T2, 'select public.set_team_discord_server(2, $1)', [OTHER_SERVER]);
      await expect(asUser(OFFICER_T2, 'select public.remove_team_discord_signup_sheet(2, $1)', [id])).rejects.toThrow(
        /not on this team/
      );
      await expect(
        asUser(OFFICER_T2, 'select public.save_team_discord_signup_sheet(2, $1, $2, $3, 2, null, null)', [
          id,
          CH_RSVPS,
          [3]
        ])
      ).rejects.toThrow(/not on this team/);
    });
  });

  it('a site admin naming a team that does not exist gets a plain message', async () => {
    await txn(async ({ q, asUser }) => {
      await verify(q, SITE_ADMIN, SERVER);
      await expect(asUser(SITE_ADMIN, 'select public.set_team_discord_server(999999, $1)', [SERVER])).rejects.toThrow(
        /team does not exist/
      );
    });
  });

  it('nobody reads or writes the new tables directly', async () => {
    await txn(async ({ asUser, asAnon }) => {
      for (const table of ['team_discord_posts', 'team_discord_signup_sheets', 'discord_server_access']) {
        await expect(asUser(OFFICER_T1, `select * from public.${table}`)).rejects.toThrow(/permission denied/);
        await expect(asAnon(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
      }
    });
  });
});
