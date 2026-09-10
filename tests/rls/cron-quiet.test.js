// The local stack does not call production (#1055).
//
// Four migrations schedule pg_cron jobs whose command carries the production
// functions URL, and every `supabase db reset` recreates them, so until the
// seed switches them off a developer machine calls production on a schedule.
// Measured here on 2026-09-10, forty minutes after a reset: ten rows in
// cron.job_run_details, ten in net._http_response, every one status 401. They
// are refused only because the local Vault holds no secret, which is a
// property of the Vault rather than of the stack being sealed.
//
// Both halves are asserted. The jobs are still scheduled, because those
// migrations are production's schedule and nothing local should change that;
// and none is active, because the seed switched them off after the fixtures.
// A test that only counted active jobs would pass just as well if the
// migrations had stopped creating them at all, which is the failure that would
// take a production schedule down.
import { describe, it, expect, afterAll } from 'vitest';
import { pool } from './helpers.js';

afterAll(() => pool.end());

const SCHEDULED = ['blizzard-gear-sync', 'optional-rsvp-reminders', 'twitch-live-check', 'wcl-progression-sync'];

const PROD_FUNCTIONS = 'kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/';

describe('cron is quiet on a local stack (#1055)', () => {
  it('still schedules every job production schedules', async () => {
    // rls-pool-read-only: reads the cron catalog, writes nothing.
    const { rows } = await pool.query('select jobname from cron.job order by jobname');
    expect(rows.map((r) => r.jobname)).toEqual(SCHEDULED);
  });

  it('leaves none of them active, so none of them fires', async () => {
    // rls-pool-read-only: reads the cron catalog, writes nothing.
    const { rows } = await pool.query('select jobname from cron.job where active order by jobname');
    expect(rows.map((r) => r.jobname)).toEqual([]);
  });

  it('still points every command at production, which is the reason they are off', async () => {
    // Deactivating is the fix rather than rewriting the URL: the command is
    // what the migration wrote, so a local edit would drift the local schema
    // from prod's in a way no check compares.
    // rls-pool-read-only: reads the cron catalog, writes nothing.
    const { rows } = await pool.query('select jobname, command from cron.job');
    expect(rows.filter((r) => !r.command.includes(PROD_FUNCTIONS)).map((r) => r.jobname)).toEqual([]);
  });
});
