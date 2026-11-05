// #1710: when RSVP changes post, set by a team's officers through
// set_team_rsvp_post(): as it happens, once a day at a time, or hours before
// each raid.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

const SERVER = '100000000000000001';
const CHANNEL = '200000000000000003';
const ROLE = '300000000000000001';

const set = (asUser, uid, args) => asUser(uid, 'select public.set_team_rsvp_post(1, $1, $2, $3, $4, $5, $6)', args);
const rsvp = async (asUser) =>
  (await asUser(OFFICER_T1, 'select public.team_discord_settings(1) as s')).rows[0].s.posts.find(
    (p) => p.kind === 'rsvp_changes'
  );
const txn = (fn) =>
  withTxn(async (ctx) => {
    await ctx.q(
      `insert into public.team_discord_config (team_id, guild_id) values (1, $1)
       on conflict (team_id) do update set guild_id = excluded.guild_id`,
      [SERVER]
    );
    return fn(ctx);
  });

describe('set_team_rsvp_post()', () => {
  it('sets each timing, reads it back, and turning it off clears the timing', async () => {
    await txn(async ({ q, asUser }) => {
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, 'daily', '09:00', 'America/New_York', 3]);
      expect(await rsvp(asUser)).toMatchObject({
        channel_id: CHANNEL,
        ping_role_id: ROLE,
        rsvp_when: 'daily',
        rsvp_time: '09:00:00',
        rsvp_timezone: 'America/New_York',
        rsvp_hours: null
      });
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, 'before_raid', '09:00', 'America/New_York', 3]);
      expect(await rsvp(asUser)).toMatchObject({
        rsvp_when: 'before_raid',
        rsvp_time: null,
        rsvp_timezone: null,
        rsvp_hours: 3
      });
      // The same again logs nothing more.
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, 'before_raid', '09:00', 'America/New_York', 3]);
      const logged = await q(
        "select count(*)::int as n from public.audit_log where team_id = 1 and action = 'Discord RSVP Timing Set'"
      );
      expect(logged.rows[0].n).toBe(2);
      // As it happens: no when.
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, null, '09:00', 'America/New_York', 3]);
      expect(await rsvp(asUser)).toMatchObject({ rsvp_when: null, rsvp_hours: null });
      await set(asUser, OFFICER_T1, [CHANNEL, null, 'daily', '09:00', 'America/New_York', 3]);
      await set(asUser, OFFICER_T1, [null, null, 'daily', '09:00', 'America/New_York', 3]);
      expect(await rsvp(asUser)).toMatchObject({ channel_id: null, rsvp_when: null, rsvp_time: null });
    });
  });

  it('still sets the channel and ping role the way set_team_discord_post() does', async () => {
    await txn(async ({ q, asUser }) => {
      await set(asUser, OFFICER_T1, [CHANNEL, ROLE, null, '09:00', 'America/New_York', 3]);
      const old = await q(
        'select attendance_channel_id, rsvp_ping_role_id from public.team_discord_config where team_id = 1'
      );
      expect(old.rows[0]).toEqual({ attendance_channel_id: CHANNEL, rsvp_ping_role_id: ROLE });
    });
  });

  it('refuses a raider, another team’s officer and a signed-out caller', async () => {
    await txn(async ({ asAnon }) => {
      await expect(
        asAnon('select public.set_team_rsvp_post(1, $1, null, null, null, null, null)', [CHANNEL])
      ).rejects.toThrow(/permission denied/);
    });
    await txn(async ({ asUser }) => {
      for (const uid of [RAIDER_T1, OFFICER_T2]) {
        await expect(set(asUser, uid, [CHANNEL, null, null, null, null, null])).rejects.toThrow(/Not authorized/);
      }
    });
  });

  it('refuses a missing time, a made-up zone, hours out of range and a ping with no channel', async () => {
    await txn(async ({ asUser }) => {
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 'daily', null, 'America/New_York', 3])).rejects.toThrow(
        /time/
      );
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 'daily', '09:00', 'Mars/Olympus', 3])).rejects.toThrow(
        /time zone/
      );
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 'before_raid', null, null, 0])).rejects.toThrow(/168 hours/);
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 'before_raid', null, null, 169])).rejects.toThrow(
        /168 hours/
      );
      await expect(set(asUser, OFFICER_T1, [CHANNEL, null, 'weekly', null, null, 3])).rejects.toThrow(/when/);
      await expect(set(asUser, OFFICER_T1, [null, ROLE, null, null, null, null])).rejects.toThrow(/channel/);
    });
  });

  it('keeps the timing to the RSVP changes kind alone', async () => {
    await txn(async ({ q }) => {
      await expect(
        q(
          "insert into public.team_discord_posts (team_id, kind, channel_id, rsvp_when, rsvp_hours) values (1, 'mplus_requests', $1, 'before_raid', 3) on conflict (team_id, kind) do update set rsvp_when = excluded.rsvp_when, rsvp_hours = excluded.rsvp_hours",
          [CHANNEL]
        )
      ).rejects.toThrow(/team_discord_posts_rsvp_timing_check/);
    });
  });
});
