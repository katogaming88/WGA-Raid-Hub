// #932: the seasons table and a foreign key on every season column.
// #933: raid_zones.season holds the code, and current_season() names the tier
// a date falls in.
// #937: boe_items.season holds the code.
// #934: season_signups.season holds the code, and team_settings.config no
// longer carries activeSignupSeason, signupsOpen or wishlistOpen.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn). The
// inserts below ride the seed's rows: team 1, players 1 and 2, items 1 and 2.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const BAD_CODE = 'MIDX';
const BAD_NAME = 'Midnight Season 9';

// One insert per season column, the season left to the case. The twelve code
// columns reference seasons(code); the one name column left references
// seasons(display_name) until #936 converts it.
const CODE_INSERTS = {
  raid_zones: "insert into public.raid_zones (wcl_zone_id, name, season) values (999, 'Season Test Zone', $1)",
  boe_items:
    "insert into public.boe_items (team_id, item_name, track, season) values (1, 'Season Test Belt', 'Hero', $1)",
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
  scoring: 'insert into public.scoring (player_id, team_id, season) values (2, 1, $1)',
  tier_token_map:
    "insert into public.tier_token_map (season, token_item_id, class, resolved_item_id) values ($1, 1, 'TestClass', 2)",
  track_bonus_ids: "insert into public.track_bonus_ids (bonus_id, track, rank, season) values (999001, 'Hero', 1, $1)",
  season_signups:
    "insert into public.season_signups (team_id, signup_name_realm, season) values (1, 'Seasontest-Illidan', $1)"
};

const NAME_INSERTS = {
  item_preferences:
    "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, 2, 2, 'bis', $1)"
};

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
      await q(CODE_INSERTS.boe_items, [null]);
      await q(CODE_INSERTS.rclc_loot, [null]);
    });
  });

  // #933 moved the column from the name to the code, so a real name is now
  // the value the key refuses.
  it('raid_zones.season takes the code and refuses the name', async () => {
    await withTxn(async ({ q }) => {
      await expect(q(CODE_INSERTS.raid_zones, ['Midnight Season 2'])).rejects.toMatchObject({
        constraint: 'raid_zones_season_fkey'
      });
    });
    await withTxn(async ({ q }) => {
      await q(CODE_INSERTS.raid_zones, ['MID2']);
      const res = await q('select season from public.raid_zones where wcl_zone_id = 999');
      expect(res.rows).toEqual([{ season: 'MID2' }]);
    });
  });

  // #937 did the same for boe_items.
  it('boe_items.season takes the code and refuses the name', async () => {
    await withTxn(async ({ q }) => {
      await expect(q(CODE_INSERTS.boe_items, ['Midnight Season 2'])).rejects.toMatchObject({
        constraint: 'boe_items_season_fkey'
      });
    });
    await withTxn(async ({ q }) => {
      const res = await q(CODE_INSERTS.boe_items + ' returning season', ['MID2']);
      expect(res.rows).toEqual([{ season: 'MID2' }]);
    });
  });

  // #934 did the same for season_signups; null stays allowed, as on boe_items.
  it('season_signups.season takes the code, refuses the name, and still allows null', async () => {
    await withTxn(async ({ q }) => {
      await expect(q(CODE_INSERTS.season_signups, ['Midnight Season 2'])).rejects.toMatchObject({
        constraint: 'season_signups_season_fkey'
      });
    });
    await withTxn(async ({ q }) => {
      const res = await q(CODE_INSERTS.season_signups + ' returning season', ['MID2']);
      expect(res.rows).toEqual([{ season: 'MID2' }]);
      await q(CODE_INSERTS.season_signups, [null]);
    });
  });
});

// #934: the signup season is the team_seasons row (#939), so the key that
// named it and the two switch keys #939 moved are gone from the column, on
// the seed and on production alike; #938 retired seasonName the same way. One definition per signup function: the
// old signatures were dropped, so PostgREST never has two candidates.
describe('after #934', () => {
  it('no team_settings.config row carries activeSignupSeason, signupsOpen, wishlistOpen or seasonName', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        "select count(*)::int as n from public.team_settings where config ?| array['activeSignupSeason', 'signupsOpen', 'wishlistOpen', 'seasonName']"
      );
      expect(res.rows[0].n).toBe(0);
    });
  });

  it('submit_season_signup and get_own_signup each have one definition, taking the tier', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        `select proname, count(*)::int as n, bool_and(pg_get_function_arguments(oid) like '%p_season text%') as takes_tier
         from pg_proc where pronamespace = 'public'::regnamespace and proname in ('submit_season_signup', 'get_own_signup')
         group by proname order by proname`
      );
      expect(res.rows).toEqual([
        { proname: 'get_own_signup', n: 1, takes_tier: true },
        { proname: 'submit_season_signup', n: 1, takes_tier: true }
      ]);
    });
  });
});

// current_season(p_on) is the latest tier whose start has passed on that day,
// by start date alone: a tier stays current until the next one's migration
// lands, which is what "dates by migration" on #1189 means. The default is
// today in Eastern. The dates here are the two tiers the seed carries.
describe('current_season()', () => {
  const on = async (q, day) => (await q('select public.current_season($1::date) as code', [day])).rows[0].code;

  it('names the tier a date falls in, inclusive of the start day', async () => {
    await withTxn(async ({ q }) => {
      expect(await on(q, '2026-05-01')).toBe('MID1');
      expect(await on(q, '2026-08-10')).toBe('MID1');
      expect(await on(q, '2026-08-11')).toBe('MID2');
      expect(await on(q, '2026-09-20')).toBe('MID2');
    });
  });

  it('is null before the first tier', async () => {
    await withTxn(async ({ q }) => {
      expect(await on(q, '2025-12-31')).toBeNull();
    });
  });

  it('defaults to today and answers with a code the table holds', async () => {
    await withTxn(async ({ q }) => {
      const res = await q('select public.current_season() = any(select code from public.seasons) as known');
      expect(res.rows).toEqual([{ known: true }]);
    });
  });

  it('is readable by anon, the way seasons itself is', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon('select public.current_season($1::date) as code', ['2026-09-20']);
      expect(res.rows).toEqual([{ code: 'MID2' }]);
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

  // Tiers never overlap: the windows are inclusive on both ends, so an
  // open-ended row runs to the end of time and a second one overlaps it.
  it('has exactly one open-ended row, and refuses a second', async () => {
    await withTxn(async ({ q }) => {
      const open = await q('select code from public.seasons where ends_at is null');
      expect(open.rows.map((r) => r.code)).toEqual(['MID2']);
      await expect(
        q(
          "insert into public.seasons (code, display_name, starts_at) values ('MID9', 'Midnight Season 9', '2027-01-05')"
        )
      ).rejects.toMatchObject({ constraint: 'seasons_no_overlap' });
    });
  });

  it('refuses a closed window that overlaps a tier', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.seasons (code, display_name, starts_at, ends_at) values ('MIDX', 'Midnight Season X', '2026-08-10', '2026-08-11')"
        )
      ).rejects.toMatchObject({ constraint: 'seasons_no_overlap' });
    });
  });

  // The two-statement shape the next tier's migration takes: close the
  // outgoing row the day before, insert the new one.
  it('(control, green both sides) the next tier lands once the outgoing row is closed', async () => {
    await withTxn(async ({ q }) => {
      await q("update public.seasons set ends_at = '2027-01-04' where code = 'MID2'");
      await q(
        "insert into public.seasons (code, display_name, starts_at) values ('MID9', 'Midnight Season 9', '2027-01-05')"
      );
      const open = await q('select code from public.seasons where ends_at is null');
      expect(open.rows.map((r) => r.code)).toEqual(['MID9']);
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
        "insert into public.seasons (code, display_name, starts_at, ends_at) values ('MID0', 'Midnight Season 0', '2025-12-01', '2025-12-02')";
      await expect(asAnon(insert)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(RAIDER_T1, insert)).rejects.toMatchObject({ code: RLS_DENIED });
      // The postgres role still can, which is what a migration runs as.
      await q(insert);
    });
  });
});
