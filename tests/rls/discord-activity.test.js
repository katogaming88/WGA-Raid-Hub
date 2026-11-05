// #1711: what the bot posted for a team, read by its officers through
// team_discord_activity(); the queue itself is service role only.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

const activity = (asUser, uid, limit = 50) => asUser(uid, 'select public.team_discord_activity(1, $1) as a', [limit]);

describe('team_discord_activity()', () => {
  it('lists the team notices newest first with a total, and not another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('delete from public.discord_post_queue');
      await q(
        `insert into public.discord_post_queue (team_id, kind, action, payload, status, posted_at, last_error, created_at)
         values (1, 'officer_requests', 'signup', '{}', 'posted', now() - interval '2 hours', null, now() - interval '2 hours'),
                (1, 'rsvp_changes', 'rsvp', '{}', 'failed', null, 'Channel not found, or the bot can''t see it', now()),
                (2, 'rsvp_changes', 'rsvp', '{}', 'posted', now(), null, now())`
      );
      const a = (await activity(asUser, OFFICER_T1)).rows[0].a;
      expect(a.total).toBe(2);
      expect(a.last_posted_at).not.toBeNull();
      expect(a.rows.map((r) => r.status)).toEqual(['failed', 'posted']);
      expect(a.rows[0].error).toMatch(/can't see it/);
      expect((await activity(asUser, OFFICER_T1, 1)).rows[0].a.rows).toHaveLength(1);
    });
  });

  it('puts a notice that posted late above one that posted earlier but was queued later', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('delete from public.discord_post_queue');
      await q(
        `insert into public.discord_post_queue (team_id, kind, action, payload, status, posted_at, created_at)
         values (1, 'rsvp_changes', 'rsvp', '{}', 'posted', now() - interval '1 hour', now() - interval '1 hour'),
                (1, 'officer_requests', 'signup', '{}', 'posted', now(), now() - interval '3 hours')`
      );
      const rows = (await activity(asUser, OFFICER_T1)).rows[0].a.rows;
      expect(rows.map((r) => r.action)).toEqual(['signup', 'rsvp']);
    });
  });

  it('refuses a raider, another team officer and a signed-out caller', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      await expect(asAnon('select public.team_discord_activity(1, 50)')).rejects.toThrow();
      await expect(activity(asUser, RAIDER_T1)).rejects.toThrow(/Not authorized/);
      await expect(activity(asUser, OFFICER_T2)).rejects.toThrow(/Not authorized/);
    });
  });
});
