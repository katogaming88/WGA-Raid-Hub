// #1845: attendance refreshes from Warcraft Logs every hour and commits
// scores on its own when nothing needs a look. The database half:
// commit_attendance_scores() (the one copy of the score math, moved out of
// both browsers), attendance_items_waiting() (what holds the commit back),
// the 'WCL (Absent?)' source, and attendance_log_names (people in the log
// who are not on the roster; listed, never holding anything back).
import { describe, it, expect } from 'vitest';
import { withTxn, seedPlayer, OFFICER_T1, OFFICER_T2, RAIDER_T1, SITE_ADMIN, RLS_DENIED } from './helpers.js';

// MID2 runs from 2026-08-11 and is the live season on the stack.
const att = (q, player, date, status, { source = 'WCL', excluded = false, team = 1 } = {}) =>
  q(
    `insert into public.attendance (team_id, player_id, raid_date, status, source, report_id, report_excluded)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [team, player, date, status, source, 'rep-' + date, excluded]
  );

const commit = (call, team = 1) => call('select public.commit_attendance_scores($1) as r', [team]);
const waiting = async (q, team = 1) => (await q('select public.attendance_items_waiting($1) as n', [team])).rows[0].n;
const score = async (q, player) =>
  (
    await q(
      `select attendance_score::float as s, attendance_pct::float as p from public.scoring
        where player_id = $1 and season = public.current_season()`,
      [player]
    )
  ).rows[0];

// The seed has its own team 1 nights; each case starts from none (rolled back).
const fresh = (q) => q('delete from public.attendance where team_id = 1');

describe('commit_attendance_scores()', () => {
  it('averages each raider over their weighted, non-excluded nights, as the browser did', async () => {
    await withTxn(async ({ q, asUser }) => {
      await fresh(q);
      const a = await seedPlayer(q, { teamId: 1 });
      const b = await seedPlayer(q, { teamId: 1 });
      await att(q, a, '2026-09-01', 'Present');
      await att(q, a, '2026-09-02', 'Late (no notice)');
      await att(q, a, '2026-09-03', 'Excused');
      // Neither counts: no status yet, and an excluded night.
      await att(q, a, '2026-09-04', null, { source: 'WCL (Late?)' });
      await att(q, a, '2026-09-05', 'No Show', { excluded: true });
      await att(q, b, '2026-09-01', 'No Show');
      await att(q, b, '2026-09-02', 'Not on Roster');

      const r = (await commit((t, p) => asUser(OFFICER_T1, t, p))).rows[0].r;
      expect(r).toEqual({ committed: 2, totalNights: 3 });
      // (1 + 0.5 + 0.8) / 3 = 0.7667
      expect(await score(q, a)).toEqual({ s: 7.67, p: 76.7 });
      expect(await score(q, b)).toEqual({ s: 0, p: 0 });
    });
  });

  it('overwrites the last commit rather than adding a second row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      await att(q, a, '2026-09-01', 'No Show');
      await commit((t, p) => asUser(OFFICER_T1, t, p));
      await q(`update public.attendance set status = 'Present', source = 'Officer' where player_id = $1`, [a]);
      await commit((t, p) => asUser(OFFICER_T1, t, p));
      expect(await score(q, a)).toEqual({ s: 10, p: 100 });
      const n = await q('select count(*)::int as n from public.scoring where player_id = $1', [a]);
      expect(n.rows[0].n).toBe(1);
    });
  });

  it('runs as the hourly job (service role), and refuses a raider and another team', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      await fresh(q);
      const a = await seedPlayer(q, { teamId: 1 });
      await att(q, a, '2026-09-01', 'Present');
      await expect(commit((t, p) => asUser(RAIDER_T1, t, p))).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(commit((t, p) => asUser(OFFICER_T2, t, p))).rejects.toMatchObject({ code: RLS_DENIED });
      expect(await score(q, a)).toBeUndefined();
      expect((await commit(asRole('service_role', null))).rows[0].r).toEqual({ committed: 1, totalNights: 1 });
    });
  });
});

describe('attendance_items_waiting()', () => {
  it('counts flagged nights this season still without a status', async () => {
    await withTxn(async ({ q }) => {
      await fresh(q);
      const a = await seedPlayer(q, { teamId: 1 });
      const b = await seedPlayer(q, { teamId: 1 });
      const other = await seedPlayer(q, { teamId: 2 });
      expect(await waiting(q)).toBe(0);
      await att(q, a, '2026-09-01', 'Present');
      await att(q, a, '2026-09-02', null, { source: 'WCL (Late?)' });
      await att(q, b, '2026-09-02', null, { source: 'WCL (Absent?)' });
      // Not counted: an excluded night, last season, another team.
      await att(q, b, '2026-09-03', null, { source: 'WCL (Absent?)', excluded: true });
      await att(q, a, '2026-07-01', null, { source: 'WCL (Late?)' });
      await att(q, other, '2026-09-02', null, { source: 'WCL (Late?)', team: 2 });
      expect(await waiting(q)).toBe(2);

      // An officer picking a status clears it.
      await q(
        `update public.attendance set status = 'Excused', source = 'Officer' where player_id = $1 and raid_date = '2026-09-02'`,
        [b]
      );
      expect(await waiting(q)).toBe(1);
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select public.attendance_items_waiting(1)')).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

describe('attendance_log_names', () => {
  const addName = (call, team = 1) =>
    call(
      `insert into public.attendance_log_names (team_id, raid_date, character_name, report_id)
       values ($1, '2026-09-01', 'pugguy', 'abc')`,
      [team]
    );
  const names = async (call) => (await call('select character_name from public.attendance_log_names')).rows;

  it('the team officer writes and reads it; another team and raiders do not', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      await addName((t, p) => asUser(OFFICER_T1, t, p));
      expect(await names((t, p) => asUser(OFFICER_T1, t, p))).toEqual([{ character_name: 'pugguy' }]);
      expect(await names((t, p) => asUser(SITE_ADMIN, t, p))).toEqual([{ character_name: 'pugguy' }]);
      expect(await names((t, p) => asUser(OFFICER_T2, t, p))).toEqual([]);
      expect(await names((t, p) => asUser(RAIDER_T1, t, p))).toEqual([]);
      await expect(names(asAnon)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(addName((t, p) => asUser(OFFICER_T2, t, p))).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(addName((t, p) => asUser(RAIDER_T1, t, p))).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('never holds back the commit', async () => {
    await withTxn(async ({ q, asRole }) => {
      await fresh(q);
      await addName(asRole('service_role', null));
      expect(await waiting(q)).toBe(0);
    });
  });
});

describe("attendance.source 'WCL (Absent?)'", () => {
  it('is accepted with a blank status', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      await att(q, a, '2026-09-01', null, { source: 'WCL (Absent?)' });
      await expect(att(q, a, '2026-09-02', null, { source: 'WCL (Gone?)' })).rejects.toThrow(/attendance_source_check/);
    });
  });
});
