// #1846: a Calendar RSVP made before the raid starts fills in attendance on
// its own. The database half: attendance_rsvps_before_start() (which RSVPs
// count as notice), set_team_attendance_tentative() (the team's choice for a
// Tentative no-show), and the 'Calendar (RSVP)' source. The fill itself is
// wcl-sync's, tested in tests/edge/wcl-sync/scheduled.test.ts.
import { describe, it, expect } from 'vitest';
import { withTxn, seedPlayer, OFFICER_T1, OFFICER_T2, RAIDER_T1 } from './helpers.js';

// An added night starts at 8 PM Eastern (raid_night_info's time zone for one),
// so 2026-09-01's start is 2026-09-02 00:00 UTC.
const NIGHT = '2026-09-01';
const START = '2026-09-02T00:00:00Z';

async function nights(q) {
  await q(
    "delete from public.raid_schedule_exceptions where team_id = 1 and raid_date in ('2026-09-01', '2026-09-03')"
  );
  await q(
    `insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type, start_time)
     values (1, '2026-09-01', 'added', '20:00'), (1, '2026-09-03', 'cancelled', null)`
  );
}

const rsvp = (q, player, date, status, updatedAt) =>
  q(
    `insert into public.raid_rsvps (team_id, player_id, raid_date, status, updated_at)
     values (1, $1, $2, $3, $4)`,
    [player, date, status, updatedAt]
  );

const counted = async (call) =>
  (
    await call(
      `select player_id, raid_date::text as d, status
         from public.attendance_rsvps_before_start(1, array['2026-09-01', '2026-09-03']::date[]) order by player_id`,
      []
    )
  ).rows;

describe('attendance_rsvps_before_start()', () => {
  it('counts an RSVP changed before the start, not one changed after it or on a cancelled night', async () => {
    await withTxn(async ({ q, asRole }) => {
      await nights(q);
      await q('delete from public.raid_rsvps where team_id = 1');
      const early = await seedPlayer(q, { teamId: 1 });
      const late = await seedPlayer(q, { teamId: 1 });
      const cancelled = await seedPlayer(q, { teamId: 1 });
      await rsvp(q, early, NIGHT, 'Absent', '2026-09-01T23:59:00Z');
      await rsvp(q, late, NIGHT, 'Absent', START);
      await rsvp(q, cancelled, '2026-09-03', 'Absent', '2026-09-01T12:00:00Z');

      expect(await counted(asRole('service_role', null))).toEqual([{ player_id: early, d: NIGHT, status: 'Absent' }]);
    });
  });

  it('answers an officer only the RSVPs raid_rsvps already shows them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nights(q);
      await q('delete from public.raid_rsvps where team_id = 1');
      const a = await seedPlayer(q, { teamId: 1 });
      await rsvp(q, a, NIGHT, 'Tentative', '2026-09-01T12:00:00Z');

      expect(await counted((t, p) => asUser(OFFICER_T1, t, p))).toHaveLength(1);
      expect(await counted((t, p) => asUser(OFFICER_T2, t, p))).toEqual([]);
    });
  });
});

const tentative = async (q) =>
  (await q("select config->>'attendanceTentative' as t from public.team_settings where team_id = 1")).rows[0].t;
const save = (call, status) => call('select public.set_team_attendance_tentative(1, $1)', [status]);

describe('set_team_attendance_tentative()', () => {
  it('saves a status, and null clears it back to Needs a look', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save((t, p) => asUser(OFFICER_T1, t, p), 'No Show');
      expect(await tentative(q)).toBe('No Show');
      await save((t, p) => asUser(OFFICER_T1, t, p), null);
      expect(await tentative(q)).toBe(null);
    });
  });

  it('refuses the leave statuses and anything not a status', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save((t, p) => asUser(OFFICER_T1, t, p), 'Medical Leave')).rejects.toThrow(/not a status/);
      await expect(save((t, p) => asUser(OFFICER_T1, t, p), 'Maybe')).rejects.toThrow(/not a status/);
    });
  });

  it("refuses a raider, and another team's officer", async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save((t, p) => asUser(RAIDER_T1, t, p), 'Excused')).rejects.toThrow(/Not authorized/);
      await expect(save((t, p) => asUser(OFFICER_T2, t, p), 'Excused')).rejects.toThrow(/Not authorized/);
    });
  });
});

describe("the 'Calendar (RSVP)' source", () => {
  it('is a source an attendance row can have', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      await q(
        `insert into public.attendance (team_id, player_id, raid_date, status, source)
         values (1, $1, $2, 'Excused', 'Calendar (RSVP)')`,
        [a, NIGHT]
      );
    });
  });
});
