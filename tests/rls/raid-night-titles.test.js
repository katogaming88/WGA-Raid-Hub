// A raid night's title (#1478): a weekly night's own on raid_schedule.title,
// and one date's own in raid_night_titles. raid_night_titles reads and writes
// as raid_schedule does: anyone reads, the team's officers and site admins
// write, and nobody else.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1, GUILD_OFFICER, SITE_ADMIN, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const DATE = '2026-10-20';
const SAVE = `insert into public.raid_night_titles (team_id, raid_date, title) values (1, '${DATE}', 'Ulatek Prog')`;
const READ = 'select team_id, raid_date::text, title from public.raid_night_titles order by team_id';
const seed = (q) => q(SAVE);

describe('raid_night_titles', () => {
  it("is written by the team's officers and site admins", async () => {
    for (const uid of [OFFICER_T1, SITE_ADMIN]) {
      await withTxn(async ({ q, asUser }) => {
        await asUser(uid, SAVE);
        await asUser(uid, "update public.raid_night_titles set title = 'Costume night'");
        expect((await q(READ)).rows).toEqual([{ team_id: 1, raid_date: DATE, title: 'Costume night' }]);
        await asUser(uid, 'delete from public.raid_night_titles');
        expect((await q(READ)).rows).toEqual([]);
      });
    }
  });

  it("refuses another team's officer, a raider and an outside guild officer", async () => {
    for (const uid of [OFFICER_T2, RAIDER_T1, GUILD_OFFICER]) {
      await withTxn(async ({ q, asUser }) => {
        await expect(asUser(uid, SAVE)).rejects.toMatchObject({ code: RLS_DENIED });
        await seed(q);
        const updated = await asUser(uid, "update public.raid_night_titles set title = 'Costume night'");
        const deleted = await asUser(uid, 'delete from public.raid_night_titles');
        expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
        expect((await q(READ)).rows).toEqual([{ team_id: 1, raid_date: DATE, title: 'Ulatek Prog' }]);
      });
    }
  });

  it('refuses a signed-out visitor any write', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(SAVE)).rejects.toMatchObject({ code: '42501' });
    });
    for (const write of [
      "update public.raid_night_titles set title = 'Costume night'",
      'delete from public.raid_night_titles'
    ]) {
      await withTxn(async ({ q, asAnon }) => {
        await seed(q);
        await expect(asAnon(write)).rejects.toMatchObject({ code: '42501' });
        expect((await q(READ)).rows).toEqual([{ team_id: 1, raid_date: DATE, title: 'Ulatek Prog' }]);
      });
    }
  });

  it('is readable by a signed-out visitor, like the schedule', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await seed(q);
      expect((await asAnon(READ)).rows).toEqual([{ team_id: 1, raid_date: DATE, title: 'Ulatek Prog' }]);
    });
  });

  it('keeps one title per team and date', async () => {
    await withTxn(async ({ q }) => {
      await seed(q);
      await expect(seed(q)).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('a title, on a date or a weekly night', () => {
  it('refuses an empty, padded or over-long title', async () => {
    for (const title of ['', ' Prog', 'x'.repeat(41)]) {
      await withTxn(async ({ q }) => {
        await expect(
          q(`insert into public.raid_night_titles (team_id, raid_date, title) values (1, $1, $2)`, [DATE, title])
        ).rejects.toMatchObject({ code: '23514' });
      });
      await withTxn(async ({ q }) => {
        await expect(
          q(`insert into public.raid_schedule (team_id, weekday, start_time, title) values (1, 2, '20:00', $1)`, [
            title
          ])
        ).rejects.toMatchObject({ code: '23514' });
      });
    }
  });

  it('lets a weekly night go without one', async () => {
    await withTxn(async ({ q }) => {
      await q(`insert into public.raid_schedule (team_id, weekday, start_time) values (1, 2, '20:00')`);
      expect((await q('select title from public.raid_schedule where team_id = 1')).rows).toEqual([{ title: null }]);
    });
  });
});
