// #1709: the weekly boss lineup post, set by a team's officers through
// set_team_weekly_lineup_post() with its day, time and time zone, and the
// week's posted message kept for the bot only.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

const SERVER = '100000000000000001';
const CHANNEL = '200000000000000003';
const ROLE = '300000000000000001';

const set = (asUser, uid, args) =>
  asUser(uid, 'select public.set_team_weekly_lineup_post(1, $1, $2, $3, $4, $5)', args);
const lineup = async (asUser) =>
  (await asUser(OFFICER_T1, 'select public.team_discord_settings(1) as s')).rows[0].s.posts.find(
    (p) => p.kind === 'weekly_lineup'
  );
const txn = (fn) =>
  withTxn(async (ctx) => {
    // The team's server, set directly: set_team_discord_server's own checks
    // are team-discord-settings.test.js's.
    await ctx.q(
      `insert into public.team_discord_config (team_id, guild_id) values (1, $1)
       on conflict (team_id) do update set guild_id = excluded.guild_id`,
      [SERVER]
    );
    return fn(ctx);
  });

describe('set_team_weekly_lineup_post()', () => {
  it('an Officer turns it on with a day, time and zone, reads it back, and turns it off', async () => {
    await txn(async ({ q, asUser }) => {
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, 3, '18:00', 'America/New_York']);
      expect(await lineup(asUser)).toMatchObject({
        channel_id: CHANNEL,
        ping_role_id: ROLE,
        post_weekday: 3,
        post_time: '18:00:00',
        post_timezone: 'America/New_York'
      });
      // The same again logs nothing.
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, 3, '18:00', 'America/New_York']);
      const logged = await q(
        "select count(*)::int as n from public.audit_log where team_id = 1 and action = 'Discord Post Set'"
      );
      expect(logged.rows[0].n).toBe(1);
      // Off clears the day, time and zone with the channel.
      await set(asUser, OFFICER_T1, [null, null, 3, '18:00', 'America/New_York']);
      expect(await lineup(asUser)).toMatchObject({
        channel_id: null,
        post_weekday: null,
        post_time: null,
        post_timezone: null
      });
    });
  });

  it('refuses a raider, another team’s officer and a signed-out caller', async () => {
    await txn(async ({ asAnon }) => {
      await expect(
        asAnon('select public.set_team_weekly_lineup_post(1, $1, null, 3, $2, $3)', [
          CHANNEL,
          '18:00',
          'America/New_York'
        ])
      ).rejects.toThrow(/permission denied/);
    });
    await txn(async ({ asUser }) => {
      for (const uid of [RAIDER_T1, OFFICER_T2]) {
        await expect(set(asUser, uid, [CHANNEL, null, 3, '18:00', 'America/New_York'])).rejects.toThrow(
          /Not authorized/
        );
      }
    });
  });

  it('refuses a missing day, time or zone, a made-up zone, and a ping with no channel', async () => {
    await txn(async ({ asUser }) => {
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, null, '18:00', 'America/New_York'])).rejects.toThrow(/day/);
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 7, '18:00', 'America/New_York'])).rejects.toThrow(/day/);
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 3, null, 'America/New_York'])).rejects.toThrow(/time/);
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 3, '18:00', 'Mars/Olympus'])).rejects.toThrow(/time zone/);
      await expect(set(asUser, OFFICER_T1, [null, ROLE, 3, '18:00', 'America/New_York'])).rejects.toThrow(/channel/);
    });
  });

  it('keeps the day, time and zone to the weekly lineup alone', async () => {
    // Each refused insert aborts its transaction, so each gets its own.
    await txn(async ({ q }) => {
      await expect(
        q(
          "insert into public.team_discord_posts (team_id, kind, channel_id, post_weekday, post_time, post_timezone) values (1, 'rsvp_changes', $1, 3, '18:00', 'America/New_York') on conflict (team_id, kind) do update set post_weekday = excluded.post_weekday, post_time = excluded.post_time, post_timezone = excluded.post_timezone",
          [CHANNEL]
        )
      ).rejects.toThrow(/team_discord_posts_schedule_check/);
    });
    await txn(async ({ q }) => {
      await expect(
        q("insert into public.team_discord_posts (team_id, kind, channel_id) values (1, 'weekly_lineup', $1)", [
          CHANNEL
        ])
      ).rejects.toThrow(/team_discord_posts_schedule_check/);
    });
  });

  it('keeps one posted message per team and week, for the service role only', async () => {
    await txn(async ({ asRole }) => {
      const service = asRole('service_role', null);
      const insert =
        "insert into public.team_lineup_posts (team_id, week_of, channel_id, message_id) values (1, '2026-11-04', $1, $2)";
      await service(insert, [CHANNEL, '1']);
      await expect(service(insert, [CHANNEL, '2'])).rejects.toThrow(/duplicate key/);
      await expect(asRole('authenticated', OFFICER_T1)('select * from public.team_lineup_posts')).rejects.toThrow(
        /permission denied/
      );
      // Nobody but the bot writes it either.
      for (const [role, uid] of [
        ['authenticated', OFFICER_T1],
        ['authenticated', RAIDER_T1],
        ['anon', null]
      ]) {
        await expect(asRole(role, uid)(insert, [CHANNEL, '3'])).rejects.toThrow(/permission denied/);
      }
    });
  });
});
