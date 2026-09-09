// raid_signup_sheets + claim_raid_signup_sheet()/raid_night_info() (#900,
// part of #640): bookkeeping for the bot-owned aggregated Discord signup
// sheet. RLS shape mirrors raid_rsvp_reminders_sent (#895) exactly -- no
// read policy for anyone but the service role, not even an officer or site
// admin, since this is pure bot bookkeeping with no end-user read use case.
//
// Everything runs inside the shared withTxn and is rolled back (#1021). This
// file used to write with autocommit pool.query and clean up in afterEach,
// which committed a team-1 Thursday raid_schedule rule where every other
// worker in the suite could read it for the few milliseconds before the
// delete, and made rotator-week-assignment.test.js fail at random.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, OFFICER_T1, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

const SHEET_COUNT = 'select count(*)::int as n from public.raid_signup_sheets where team_id = 1';

function seedSheetRow(q) {
  return q("insert into public.raid_signup_sheets (team_id, raid_date, channel_id) values (1, '2026-09-10', 'chan-A')");
}

// Seeds as postgres, asserts the row is really there, then answers with what
// the impersonated role can see on that same connection. The first assertion
// is the control: without it a seed that silently failed would read as a
// successful denial.
async function visibleTo(q, asRole, role, uid) {
  await seedSheetRow(q);
  expect((await q(SHEET_COUNT)).rows[0].n).toBe(1);
  return (await asRole(role, uid)(SHEET_COUNT)).rows[0].n;
}

describe('raid_signup_sheets RLS', () => {
  it('a raider sees zero rows', async () => {
    await withTxn(async ({ q, asRole }) => {
      expect(await visibleTo(q, asRole, 'authenticated', RAIDER_T1)).toBe(0);
    });
  });

  it('an officer on the same team sees zero rows', async () => {
    await withTxn(async ({ q, asRole }) => {
      expect(await visibleTo(q, asRole, 'authenticated', OFFICER_T1)).toBe(0);
    });
  });

  it('a site admin sees zero rows', async () => {
    await withTxn(async ({ q, asRole }) => {
      expect(await visibleTo(q, asRole, 'authenticated', SITE_ADMIN)).toBe(0);
    });
  });

  it('a guild officer sees zero rows', async () => {
    await withTxn(async ({ q, asRole }) => {
      expect(await visibleTo(q, asRole, 'authenticated', GUILD_OFFICER)).toBe(0);
    });
  });

  it('an anonymous caller sees zero rows', async () => {
    await withTxn(async ({ q, asRole }) => {
      expect(await visibleTo(q, asRole, 'anon', null)).toBe(0);
    });
  });
});

describe('claim_raid_signup_sheet()', () => {
  it('returns null on the first call for a fresh date, and creates the row', async () => {
    await withTxn(async ({ q }) => {
      const res = await q("select * from claim_raid_signup_sheet(1, '2026-09-10', 'chan-A')");
      expect(res.rows[0].message_id).toBeNull();
      const row = await q("select * from raid_signup_sheets where team_id = 1 and raid_date = '2026-09-10'");
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].channel_id).toBe('chan-A');
      expect(row.rows[0].message_id).toBeNull();
    });
  });

  it('returns the stored message_id on a later call with the same channel', async () => {
    await withTxn(async ({ q }) => {
      await q("select * from claim_raid_signup_sheet(1, '2026-09-10', 'chan-A')");
      await q("update raid_signup_sheets set message_id = 'msg-123' where team_id = 1 and raid_date = '2026-09-10'");
      const res = await q("select * from claim_raid_signup_sheet(1, '2026-09-10', 'chan-A')");
      expect(res.rows[0].message_id).toBe('msg-123');
    });
  });

  it('resets message_id to null and updates channel_id when the configured channel changes', async () => {
    await withTxn(async ({ q }) => {
      await q("select * from claim_raid_signup_sheet(1, '2026-09-10', 'chan-A')");
      await q("update raid_signup_sheets set message_id = 'msg-123' where team_id = 1 and raid_date = '2026-09-10'");
      const res = await q("select * from claim_raid_signup_sheet(1, '2026-09-10', 'chan-B')");
      expect(res.rows[0].message_id).toBeNull();
      const row = await q("select channel_id from raid_signup_sheets where team_id = 1 and raid_date = '2026-09-10'");
      expect(row.rows[0].channel_id).toBe('chan-B');
    });
  });
});

describe('raid_night_info()', () => {
  it('reports no raid night for a date with no matching schedule or exception row', async () => {
    await withTxn(async ({ q }) => {
      const res = await q("select * from raid_night_info(1, '2026-09-10')");
      expect(res.rows[0].exists).toBe(false);
    });
  });

  it('reports the active recurring rule for a matching weekday', async () => {
    await withTxn(async ({ q }) => {
      // 2026-09-10 is a Thursday = weekday 4.
      await q(
        "insert into raid_schedule (team_id, weekday, start_time, timezone, is_optional) values (1, 4, '20:00', 'America/New_York', false)"
      );
      const res = await q("select * from raid_night_info(1, '2026-09-10')");
      expect(res.rows[0].exists).toBe(true);
      expect(res.rows[0].start_time).toBe('20:00:00');
      expect(res.rows[0].timezone).toBe('America/New_York');
      expect(res.rows[0].is_optional).toBe(false);
    });
  });

  it('reports an added exception night', async () => {
    await withTxn(async ({ q }) => {
      await q(
        "insert into raid_schedule_exceptions (team_id, raid_date, exception_type, start_time, is_optional) values (1, '2026-09-11', 'added', '19:00', true)"
      );
      const res = await q("select * from raid_night_info(1, '2026-09-11')");
      expect(res.rows[0].exists).toBe(true);
      expect(res.rows[0].start_time).toBe('19:00:00');
      expect(res.rows[0].is_optional).toBe(true);
    });
  });

  it('a cancelled exception wins over an active recurring rule for the same date', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into raid_schedule (team_id, weekday, start_time, is_optional) values (1, 4, '21:00', false)");
      await q(
        "insert into raid_schedule_exceptions (team_id, raid_date, exception_type) values (1, '2026-09-17', 'cancelled')"
      );
      const res = await q("select * from raid_night_info(1, '2026-09-17')");
      expect(res.rows[0].exists).toBe(false);
    });
  });
});

afterAll(() => pool.end());
