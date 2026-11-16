// #1639: character_weeks.best_item_level is the highest item level a
// character had in any week, kept by a trigger so the audit page can show
// "highest ever" without a PvP-gear log-out dragging a raider down.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn } from './helpers.js';

afterAll(() => pool.end());

const NAME = 'Katorrí-Stormrage';
const put = (q, week, level) =>
  q(
    `insert into public.character_weeks (week_of, name_realm, item_level) values ($1, $2, $3)
     on conflict (name_realm_key, week_of) do update set item_level = excluded.item_level`,
    [week, NAME, level]
  );
const read = async (q, week) =>
  (
    await q(
      'select item_level, best_item_level from public.character_weeks where name_realm_key = $1 and week_of = $2',
      ['katorrí-stormrage', week]
    )
  ).rows[0];

describe('character_weeks.best_item_level', () => {
  it('starts as the first read', async () => {
    await withTxn(async ({ q }) => {
      await put(q, '2026-11-03', 300);
      expect(await read(q, '2026-11-03')).toEqual({ item_level: 300, best_item_level: 300 });
    });
  });

  it('carries the best of earlier weeks, so a PvP-gear week does not lower it', async () => {
    await withTxn(async ({ q }) => {
      await put(q, '2026-11-03', 300);
      await put(q, '2026-11-10', 266);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: 266, best_item_level: 300 });
    });
  });

  it('never goes down when the same week is read again in lower gear', async () => {
    await withTxn(async ({ q }) => {
      await put(q, '2026-11-10', 310);
      await put(q, '2026-11-10', 270);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: 270, best_item_level: 310 });
    });
  });

  it('matches the character by its name as the key is built, and a failed read still carries the best', async () => {
    await withTxn(async ({ q }) => {
      await q(
        `insert into public.character_weeks (week_of, name_realm, item_level) values ('2026-11-03', 'Katorri-Area 52', 300)`
      );
      // The next week's summary read failed (no level) and the name is typed differently.
      await q(`insert into public.character_weeks (week_of, name_realm) values ('2026-11-10', 'katorri-area52')`);
      const { rows } = await q(
        `select week_of::text, item_level, best_item_level from public.character_weeks where name_realm_key = 'katorri-area52' order by week_of`
      );
      expect(rows).toEqual([
        { week_of: '2026-11-03', item_level: 300, best_item_level: 300 },
        { week_of: '2026-11-10', item_level: null, best_item_level: 300 }
      ]);
    });
  });

  it('starts over with a new season, so an item level squish does not leave the mark stuck', async () => {
    await withTxn(async ({ q }) => {
      // MID2 is open-ended, and seasons never overlap: close it, then start a new one.
      await q(`update public.seasons set ends_at = '2026-12-07' where code = 'MID2'`);
      await q(
        `insert into public.seasons (code, display_name, starts_at, ends_at) values ('TSTSQ', 'Squish test', '2026-12-08', '2027-06-01')`
      );
      await put(q, '2026-12-01', 300);
      await put(q, '2026-12-08', 90);
      expect(await read(q, '2026-12-08')).toEqual({ item_level: 90, best_item_level: 90 });
      // The old season's weeks keep their own mark.
      expect(await read(q, '2026-12-01')).toEqual({ item_level: 300, best_item_level: 300 });
    });
  });

  it('is null for a character never read', async () => {
    await withTxn(async ({ q }) => {
      await q(`insert into public.character_weeks (week_of, name_realm) values ('2026-11-10', $1)`, [NAME]);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: null, best_item_level: null });
    });
  });
});
