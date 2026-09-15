// #1174: the gear sweep's last-run records on site_settings, one column for
// the scheduled sweep and one for an officer's on-demand sync. The row is
// public-read already; only the service role writes them, from the function.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

const COLUMNS = 'gear_sync_last_cron_run, gear_sync_last_officer_run';
const RUN = JSON.stringify({
  trigger: 'cron',
  started_at: '2026-09-15T10:07:03.000Z',
  finished_at: '2026-09-15T10:07:21.000Z',
  synced: 55,
  skipped: 0,
  teams: 3,
  players: 55,
  error: null
});

describe('site_settings gear sync records (#1174)', () => {
  it('anyone can read both columns on the settings row, empty until a sweep records', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon(`select ${COLUMNS} from public.site_settings where id = 1`);
      expect(res.rows).toEqual([{ gear_sync_last_cron_run: null, gear_sync_last_officer_run: null }]);
    });
  });

  it('an officer cannot write either column; the owner (what the service role sees) can', async () => {
    await withTxn(async ({ q, asUser }) => {
      for (const column of ['gear_sync_last_cron_run', 'gear_sync_last_officer_run']) {
        const asOfficer = await asUser(
          OFFICER_T1,
          `update public.site_settings set ${column} = $1::jsonb where id = 1 returning id`,
          [RUN]
        );
        expect(asOfficer.rows).toEqual([]);
        const still = await q(`select ${column} as run from public.site_settings where id = 1`);
        expect(still.rows[0].run).toBeNull();

        await q(`update public.site_settings set ${column} = $1::jsonb where id = 1`, [RUN]);
        const now = await q(`select ${column} as run from public.site_settings where id = 1`);
        expect(now.rows[0].run).toMatchObject({ trigger: 'cron', synced: 55, error: null });
      }
    });
  });
});
