// #1267: a tier's item level floor per gear track lives in season_track_floors,
// set by the migration that adds the tier, and the gear sync grades gear with
// no track bonus id against the current tier's floors.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const FLOORS = 'select track, item_level from public.season_track_floors where season = $1 order by item_level desc';

const MID2 = [
  { track: 'Myth', item_level: 318 },
  { track: 'Hero', item_level: 305 },
  { track: 'Champion', item_level: 292 },
  { track: 'Veteran', item_level: 279 },
  { track: 'Adventurer', item_level: 266 },
  { track: 'Explorer', item_level: 207 }
];

describe('season_track_floors', () => {
  it('holds the six Midnight Season 2 floors, and none for Midnight Season 1', async () => {
    await withTxn(async ({ q }) => {
      expect((await q(FLOORS, ['MID2'])).rows).toEqual(MID2);
      expect((await q(FLOORS, ['MID1'])).rows).toEqual([]);
    });
  });

  // Goes red the day a tier is added by a migration that forgot its floors:
  // the sync would then grade no gear without a track bonus id on any team.
  it('the current tier has a floor for every track', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        'select count(*)::int as n from public.season_track_floors where season = public.current_season()'
      );
      expect(res.rows[0].n).toBe(6);
    });
  });

  it('anyone can read the floors, signed in or not', async () => {
    await withTxn(async ({ asAnon, asUser }) => {
      expect((await asAnon(FLOORS, ['MID2'])).rows).toEqual(MID2);
      expect((await asUser(RAIDER_T1, FLOORS, ['MID2'])).rows).toEqual(MID2);
    });
  });

  // No write policy: an insert is refused, and an update or delete matches no
  // row, as on track_bonus_ids.
  it('an officer cannot write them; they arrive with the tier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.season_track_floors (season, track, item_level) values ('MID1', 'Hero', 1)"
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
      const updated = await asUser(
        OFFICER_T1,
        "update public.season_track_floors set item_level = 1 where season = 'MID2'"
      );
      const deleted = await asUser(OFFICER_T1, "delete from public.season_track_floors where season = 'MID2'");
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
      expect((await q(FLOORS, ['MID2'])).rows).toEqual(MID2);
    });
  });

  it('refuses a track that is not one of the six', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.season_track_floors (season, track, item_level) values ('MID1', 'Heroic', 300)")
      ).rejects.toMatchObject({ constraint: 'season_track_floors_track_check' });
    });
  });

  it('refuses a floor of zero', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.season_track_floors (season, track, item_level) values ('MID1', 'Hero', 0)")
      ).rejects.toMatchObject({ constraint: 'season_track_floors_item_level_check' });
    });
  });

  it('holds one floor per track per tier', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.season_track_floors (season, track, item_level) values ('MID2', 'Hero', 306)")
      ).rejects.toMatchObject({ constraint: 'season_track_floors_pkey' });
    });
  });
});
