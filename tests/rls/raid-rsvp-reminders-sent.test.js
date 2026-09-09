// raid_rsvp_reminders_sent (#895, part of #640, Phase 4): pure dedup log for
// the optional-night 24h/2h DM reminder sweep, written only by the
// optional-rsvp-reminders Edge Function via the service role. RLS is
// enabled with no read policy for anyone -- not even an officer or site
// admin, unlike most other tables -- so this just asserts every ordinary
// caller sees zero rows, same shape as write-policies.test.js's denial
// checks but for SELECT (RLS makes a non-matching SELECT return empty
// rather than error, since base table grants already exist per #284).
//
// Everything runs inside the shared withTxn and is rolled back (#1021). This
// file wrote with autocommit pool.query and cleaned up in afterEach, the
// shape that made another file's tests fail at random. Nothing else reads
// this table, so it had no victim of its own.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, OFFICER_T1, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

const REMINDER_COUNT = 'select count(*)::int as n from public.raid_rsvp_reminders_sent where team_id = 1';

function seedReminderRow(q) {
  return q(
    "insert into public.raid_rsvp_reminders_sent (team_id, player_id, raid_date, checkpoint) values (1, 1, '2026-09-10', '24h')"
  );
}

// Seeds as postgres, asserts the row is really there, then answers with what
// the impersonated role can see on that same connection. The first assertion
// is the control: without it a seed that silently failed would read as a
// successful denial.
async function visibleTo(q, asRole, role, uid) {
  await seedReminderRow(q);
  expect((await q(REMINDER_COUNT)).rows[0].n).toBe(1);
  return (await asRole(role, uid)(REMINDER_COUNT)).rows[0].n;
}

describe('raid_rsvp_reminders_sent RLS', () => {
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

afterAll(() => pool.end());
