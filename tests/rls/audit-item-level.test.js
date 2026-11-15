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
      await put(q, '2026-11-03', 721);
      expect(await read(q, '2026-11-03')).toEqual({ item_level: 721, best_item_level: 721 });
    });
  });

  it('carries the best of earlier weeks, so a PvP-gear week does not lower it', async () => {
    await withTxn(async ({ q }) => {
      await put(q, '2026-11-03', 721);
      await put(q, '2026-11-10', 688);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: 688, best_item_level: 721 });
    });
  });

  it('never goes down when the same week is read again in lower gear', async () => {
    await withTxn(async ({ q }) => {
      await put(q, '2026-11-10', 725);
      await put(q, '2026-11-10', 690);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: 690, best_item_level: 725 });
    });
  });

  it('is null for a character never read', async () => {
    await withTxn(async ({ q }) => {
      await q(`insert into public.character_weeks (week_of, name_realm) values ('2026-11-10', $1)`, [NAME]);
      expect(await read(q, '2026-11-10')).toEqual({ item_level: null, best_item_level: null });
    });
  });
});
