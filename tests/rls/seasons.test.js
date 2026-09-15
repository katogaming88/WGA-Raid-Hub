// #932: the seasons table, a foreign key on every season column, and one
// definition of the guild's current tier (current_season()).
//
// Each test runs in one rolled-back transaction (helpers.js withTxn). The
// inserts below ride the seed's rows: team 1, players 1 and 2, items 1 and 2.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const BAD_CODE = 'MIDX';
const BAD_NAME = 'Midnight Season 9';

// One insert per season column, the season left to the case. The nine code
// columns reference seasons(code); the five name columns reference
// seasons(display_name).
const CODE_INSERTS = {
  player_wcl_season_perf: 'insert into public.player_wcl_season_perf (player_id, team_id, season) values (2, 1, $1)',
  priority_conflict_dismissals:
    "insert into public.priority_conflict_dismissals (team_id, player_id, season, boss, track) values (1, 1, $1, 'Season Test Boss', 'Hero')",
  priority_order:
    "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 2, 'Hero', 1, 1)",
  priority_order_confirmed_empty:
    "insert into public.priority_order_confirmed_empty (team_id, season, item_id, track) values (1, $1, 2, 'Hero')",
  priority_stale_dismissals:
    'insert into public.priority_stale_dismissals (team_id, player_id, season, item_id) values (1, 1, $1, 2)',
  rclc_loot: "insert into public.rclc_loot (team_id, player_id, item_id, track, season) values (1, 1, 2, 'Hero', $1)",
  scoring: 'insert into public.scoring (player_id, season) values (2, $1)',
  tier_token_map:
    "insert into public.tier_token_map (season, token_item_id, class, resolved_item_id) values ($1, 1, 'TestClass', 2)",
  track_bonus_ids: "insert into public.track_bonus_ids (bonus_id, track, rank, season) values (999001, 'Hero', 1, $1)"
};

const NAME_INSERTS = {
  bis_items: 'insert into public.bis_items (player_id, item_id, season) values (2, 2, $1)',
  boe_items:
    "insert into public.boe_items (team_id, item_name, track, season) values (1, 'Season Test Belt', 'Hero', $1)",
  item_preferences:
    "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, 2, 2, 'bis', $1)",
  raid_zones: "insert into public.raid_zones (wcl_zone_id, name, season) values (999, 'Season Test Zone', $1)",
  season_signups:
    "insert into public.season_signups (team_id, signup_name_realm, season) values (1, 'Seasontest-Illidan', $1)"
};

// The function's own idea of today (America/New_York, the project's zone),
// so a boundary case lands on the same calendar day the function reads.
const TODAY = "(now() at time zone 'America/New_York')::date";

describe('every season column is a foreign key to seasons', () => {
  for (const [table, sql] of Object.entries(CODE_INSERTS)) {
    it(`${table}.season refuses a code that is not a season`, async () => {
      await withTxn(async ({ q }) => {
        await expect(q(sql, [BAD_CODE])).rejects.toMatchObject({ constraint: `${table}_season_fkey` });
      });
    });
  }

  for (const [table, sql] of Object.entries(NAME_INSERTS)) {
    it(`${table}.season refuses a name that is not a season`, async () => {
      await withTxn(async ({ q }) => {
        await expect(q(sql, [BAD_NAME])).rejects.toMatchObject({ constraint: `${table}_season_fkey` });
      });
    });
  }

  // Green on both sides of the migration: the values production holds today
  // insert before the keys exist and after.
  it('(control, green both sides) a real code and a real name insert, and null stays allowed where it was', async () => {
    await withTxn(async ({ q }) => {
      await q(CODE_INSERTS.scoring, ['MID2']);
      await q(NAME_INSERTS.item_preferences, ['Midnight Season 2']);
      await q(NAME_INSERTS.boe_items, [null]);
      await q(CODE_INSERTS.rclc_loot, [null]);
    });
  });
});

describe('seasons', () => {
  // The seed adds one closed fixture season of its own (supabase/seed.sql),
  // so a local stack holds three rows and production two.
  it('holds the two tiers with their dates, plus the seed fixture', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        'select code, display_name, starts_at::text as starts_at, ends_at::text as ends_at from public.seasons order by starts_at'
      );
      expect(res.rows).toEqual([
        { code: 'seed-season', display_name: 'seed-season', starts_at: '2026-01-01', ends_at: '2026-01-31' },
        { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-03-17', ends_at: '2026-08-10' },
        { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null }
      ]);
    });
  });

  it('has exactly one open-ended row, and refuses a second', async () => {
    await withTxn(async ({ q }) => {
      const open = await q('select code from public.seasons where ends_at is null');
      expect(open.rows.map((r) => r.code)).toEqual(['MID2']);
      await expect(
        q(
          "insert into public.seasons (code, display_name, starts_at) values ('MID9', 'Midnight Season 9', '2027-01-05')"
        )
      ).rejects.toMatchObject({ constraint: 'seasons_one_open_ended' });
    });
  });

  it('refuses a window that ends before it starts', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.seasons (code, display_name, starts_at, ends_at) values ('MID0', 'Midnight Season 0', '2026-02-01', '2026-01-01')"
        )
      ).rejects.toMatchObject({ constraint: 'seasons_window_check' });
    });
  });

  it('is readable by anyone and writable by nobody through the API roles', async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      const anon = await asAnon('select code from public.seasons order by code');
      expect(anon.rows.map((r) => r.code)).toEqual(['MID1', 'MID2', 'seed-season']);
      const raider = await asUser(RAIDER_T1, 'select code from public.seasons order by code');
      expect(raider.rows.map((r) => r.code)).toEqual(['MID1', 'MID2', 'seed-season']);
      const insert =
        "insert into public.seasons (code, display_name, starts_at, ends_at) values ('MID0', 'Midnight Season 0', '2026-01-01', '2026-01-02')";
      await expect(asAnon(insert)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(RAIDER_T1, insert)).rejects.toMatchObject({ code: RLS_DENIED });
      // The postgres role still can, which is what a migration runs as.
      await q(insert);
    });
  });
});

describe('current_season()', () => {
  it('returns the latest tier that has started: MID2 today', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const res = await asAnon('select code from public.current_season()');
      expect(res.rows.map((r) => r.code)).toEqual(['MID2']);
    });
  });

  // The two-statement shape the next tier's migration takes: close the
  // outgoing row, insert the new one. Landed on launch day it is current at
  // once; landed early with a future start, the outgoing tier stays current
  // even though its window has closed, so there is never a gap.
  it('a tier starting today is current the moment it lands', async () => {
    await withTxn(async ({ q }) => {
      await q(`update public.seasons set ends_at = ${TODAY} - 1 where code = 'MID2'`);
      await q(
        `insert into public.seasons (code, display_name, starts_at) values ('MID9', 'Midnight Season 9', ${TODAY})`
      );
      const res = await q('select code from public.current_season()');
      expect(res.rows.map((r) => r.code)).toEqual(['MID9']);
    });
  });

  it('a tier starting tomorrow leaves the outgoing tier current', async () => {
    await withTxn(async ({ q }) => {
      await q(`update public.seasons set ends_at = ${TODAY} - 1 where code = 'MID2'`);
      await q(
        `insert into public.seasons (code, display_name, starts_at) values ('MID9', 'Midnight Season 9', ${TODAY} + 1)`
      );
      const res = await q('select code from public.current_season()');
      expect(res.rows.map((r) => r.code)).toEqual(['MID2']);
    });
  });

  it('returns no row before any tier has started', async () => {
    await withTxn(async ({ q }) => {
      await q(`update public.seasons set starts_at = ${TODAY} + 1, ends_at = null where code = 'MID2'`);
      await q(`update public.seasons set starts_at = ${TODAY} + 1, ends_at = ${TODAY} + 1 where code <> 'MID2'`);
      const res = await q('select code from public.current_season()');
      expect(res.rows).toEqual([]);
    });
  });
});
