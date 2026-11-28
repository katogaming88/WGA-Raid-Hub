// Behavior tests for import_rclc_loot() (#219). Mainly exercises track
// (difficulty) parsing off the RCLC "instance" string -- including the
// Sporefall regression (20260806214054) where a Mythic Flex raid's instance
// string ("Sporefall-Mythic - Flexible Raiding") broke the old "everything
// after the last hyphen" parser and silently left every row's track null.
// Also covers dedupe-by-rclc_id and unknown-player/unresolved-item handling,
// since nothing in this repo tested this function before.
//
// Each test runs in one rolled-back transaction: the RPC call happens as the
// team 1 officer/leader, assertions happen back as postgres -- same pattern
// tests/rls/promotion.test.js uses, since writes never commit across
// separate pool connections here.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn as withSharedTxn, seedPlayer, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): item 1 is
// 'Seed Test Staff' (wow_item_id 100001). The player the rows name is the
// file's own: every case mints it on team 1 before importing (#1123), so
// the loot rows reference no seeded character.
const SEED_ITEM_WOW_ID = 100001;
const IMPORT_PLAYER_NAME = 'Fixtureloot-Illidan';

function row(overrides) {
  return {
    player: IMPORT_PLAYER_NAME,
    id: 'test-' + Math.random().toString(36).slice(2),
    itemID: SEED_ITEM_WOW_ID,
    itemName: 'Seed Test Staff',
    instance: 'The Voidspire-Heroic',
    boss: 'Some Boss',
    date: '2026/06/22',
    time: '22:00:00',
    ...overrides
  };
}

// Wraps the shared harness: asRole runs one statement as the given uid
// (authenticated), then restores postgres. The character the rows name is
// minted first, as postgres, so the import resolves it by name.
async function withTxn(fn) {
  return withSharedTxn(async ({ q, asUser }) => {
    await seedPlayer(q, { teamId: 1, nameRealm: IMPORT_PLAYER_NAME });
    return fn(q, asUser);
  });
}

// A boss on the raid boss list, for an unknown item that is still raid gear.
const RAID_BOSS = 'Nek’zali the Soulcoiler';
const seedBoss = async (q) => {
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9300, 99300, 'Import Test Raid', 'MID2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (9301, 9300, 3901, 'Nek''zali the Soulcoiler', 0)`);
};

const importAs = (asRole, uid, rows) =>
  asRole(uid, 'select public.import_rclc_loot(1, $1, $2::jsonb) as result', ['MID1', JSON.stringify(rows)]);

describe('import_rclc_loot track parsing', () => {
  it('parses the classic "<Name>-<Difficulty>" instance format', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'track-hero', instance: 'The Voidspire-Heroic' }),
        row({ id: 'track-myth', instance: 'The Dreamrift-Mythic' }),
        row({ id: 'track-normal', instance: 'The Voidspire-Normal' })
      ]);
      expect(res.rows[0].result.inserted).toBe(3);

      const tracks = await q(
        `select rclc_id, track from public.rclc_loot where rclc_id in ('track-hero','track-myth','track-normal')`
      );
      const byId = Object.fromEntries(tracks.rows.map((r) => [r.rclc_id, r.track]));
      expect(byId['track-hero']).toBe('Hero');
      expect(byId['track-myth']).toBe('Myth');
      expect(byId['track-normal']).toBe('Champion');
    });
  });

  it('parses a Mythic Flex instance string with a trailing qualifier (regression, 20260806214054)', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'track-flex', instance: 'Sporefall-Mythic - Flexible Raiding' })
      ]);
      expect(res.rows[0].result.inserted).toBe(1);

      const track = await q(`select track from public.rclc_loot where rclc_id = 'track-flex'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('leaves track null for an unrecognized instance string rather than guessing', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'track-unknown', instance: 'Some Made Up Zone' })]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'track-unknown'`);
      expect(track.rows[0].track).toBeNull();
    });
  });
});

// 20260829200033: track is preferred from the item's own bonus IDs (baked in
// at generation, immune to drift) over the free-text instance string (which
// can go stale -- see the migration header comment for the live incident
// that prompted this: loot passed out after the raid had already moved to a
// different pull recorded the wrong instance/boss). Season MID2 bonus-ID
// ranges confirmed against Wowhead for the "Font of Venomous Rage" trinket;
// synthetic itemStrings below mirror the real RCLC export shape (verified
// against three real Season MID2 export entries) with just the bonus ID(s)
// swapped -- "item:<id>::::::::90:266::3:<numBonusIds>:<bonusId...>:1:28:<n>".
describe('import_rclc_loot track from bonus IDs (20260829200033)', () => {
  it('reads Champion track from a single bonus ID in the Champion range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-champion',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12835:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-champion'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });

  it('reads Hero track from a single bonus ID in the Hero range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-hero',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12843:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-hero'`);
      expect(track.rows[0].track).toBe('Hero');
    });
  });

  it('reads Myth track from a single bonus ID in the Myth range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-myth',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12851:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-myth'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('reads Myth track from the 9/6 special-drop bonus ID (13848)', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-myth-special',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::5:2:13335:13848:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-myth-special'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('prefers the bonus ID over a stale/misleading instance string (the live incident)', async () => {
    await withTxn(async (q, asRole) => {
      // Instance string claims Heroic (as if the drop came from a later
      // Heroic pull), but the item's own bonus ID says Champion -- bonus ID
      // must win, since it's what actually generated the item.
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-overrides-instance',
          instance: 'The Twin Fangs-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12836:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-overrides-instance'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });

  it('falls back to instance-string parsing when itemString has no recognized bonus ID', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-unmatched-fallback',
          instance: 'The Voidspire-Mythic',
          itemString: 'item:100001::::::::90:266::3:1:99999:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-unmatched-fallback'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('falls back to instance-string parsing when itemString is missing entirely', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'bonus-missing-fallback', instance: 'The Voidspire-Normal' })]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-missing-fallback'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });
});

describe('import_rclc_loot general behavior', () => {
  it('resolves item_id by wow_item_id and player_id by exact name match', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [row({ id: 'resolve-1' })]);
      expect(res.rows[0].result.unresolved_item).toBe(0);

      const inserted = await q(`select item_id, player_id from public.rclc_loot where rclc_id = 'resolve-1'`);
      const player = await q(`select id from public.players where team_id = 1 and name_realm = $1`, [
        IMPORT_PLAYER_NAME
      ]);
      const item = await q(`select id from public.items where wow_item_id = $1`, [SEED_ITEM_WOW_ID]);
      expect(inserted.rows[0].item_id).toBe(item.rows[0].id);
      expect(inserted.rows[0].player_id).toBe(player.rows[0].id);
    });
  });

  it('creates an archived stub player for an unknown name instead of leaving player_id null', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'unknown-player', player: 'Totallynewperson-Illidan' })]);
      const player = await q(
        `select archived_at is not null as is_archived from public.players where team_id = 1 and name_realm = 'Totallynewperson-Illidan'`
      );
      expect(player.rows).toHaveLength(1);
      expect(player.rows[0].is_archived).toBe(true);
    });
  });

  it('counts an unresolvable item from a raid boss without failing the row', async () => {
    await withTxn(async (q, asRole) => {
      await seedBoss(q);
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'unresolved-1', itemID: 999999999, itemName: 'Not A Real Item', boss: RAID_BOSS })
      ]);
      expect(res.rows[0].result.inserted).toBe(1);
      expect(res.rows[0].result.unresolved_item).toBe(1);

      const inserted = await q(`select item_id from public.rclc_loot where rclc_id = 'unresolved-1'`);
      expect(inserted.rows[0].item_id).toBeNull();
    });
  });

  it('dedupes a second import of the same rclc_id', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'dupe-1' })]);
      const res = await importAs(asRole, OFFICER_T1, [row({ id: 'dupe-1' })]);
      expect(res.rows[0].result.inserted).toBe(0);
      expect(res.rows[0].result.skipped_duplicate).toBe(1);
    });
  });

  it('files each award under the season of its own date, and leaves out one from before the first season (#1579)', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'season-old', date: '2025/12/01', player: 'Lastexpansion-Illidan' }),
        row({ id: 'season-1', date: '2026/06/22' }),
        row({ id: 'season-2', date: '2026/09/01' })
      ]);
      const result = res.rows[0].result;
      expect(result).toMatchObject({ inserted: 2, skipped_before_seasons: 1 });
      expect(result.skipped).toEqual([
        {
          item: 'Seed Test Staff',
          boss: 'Some Boss',
          player: 'Lastexpansion-Illidan',
          date: '2025-12-01',
          reason: 'before_seasons'
        }
      ]);
      const seasons = await q(
        `select rclc_id, season from public.rclc_loot where rclc_id like 'season-%' order by rclc_id`
      );
      expect(seasons.rows).toEqual([
        { rclc_id: 'season-1', season: 'MID1' },
        { rclc_id: 'season-2', season: 'MID2' }
      ]);
      // A row left out never makes a placeholder character.
      const stub = await q(`select 1 from public.players where name_realm = 'Lastexpansion-Illidan'`);
      expect(stub.rows).toHaveLength(0);
    });
  });

  it('files an award whose date cannot be read under the season the page passed', async () => {
    await withTxn(async (q, asRole) => {
      // Unreadable, and empty, which the current site sends for an entry with no date.
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'no-date', date: 'yesterday' }),
        row({ id: 'empty-date', date: '', time: '22:30:00' })
      ]);
      expect(res.rows[0].result).toMatchObject({ inserted: 2, skipped_before_seasons: 0 });
      const season = await q(
        `select rclc_id, season from public.rclc_loot where rclc_id in ('no-date', 'empty-date') order by rclc_id`
      );
      expect(season.rows).toEqual([
        { rclc_id: 'empty-date', season: 'MID1' },
        { rclc_id: 'no-date', season: 'MID1' }
      ]);
    });
  });

  it('leaves out an unknown item from a boss off the raid list, and keeps a known item from anywhere (#1579)', async () => {
    await withTxn(async (q, asRole) => {
      await seedBoss(q);
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'toy', itemID: 999999991, itemName: 'Cosmic Ritual Stone', boss: 'Scourgelord Tyrannus' }),
        row({ id: 'no-boss', itemID: 999999992, itemName: 'Plans: Blood Knight’s Impetus', boss: '' }),
        row({ id: 'new-boss-item', itemID: 999999993, itemName: 'Not Loaded Yet', boss: RAID_BOSS }),
        row({ id: 'known-item', boss: 'Scourgelord Tyrannus' })
      ]);
      const result = res.rows[0].result;
      expect(result).toMatchObject({ inserted: 2, skipped_not_raid_gear: 2, unresolved_item: 1 });
      expect(result.skipped.map((s) => [s.item, s.reason])).toEqual([
        ['Cosmic Ritual Stone', 'not_raid_gear'],
        ['Plans: Blood Knight’s Impetus', 'not_raid_gear']
      ]);
      const kept = await q(`select rclc_id from public.rclc_loot where rclc_id in ('new-boss-item', 'known-item')`);
      expect(kept.rows).toHaveLength(2);
    });
  });

  it('keeps two real copies of one item to one raider, and skips both when another client sends them again', async () => {
    await withTxn(async (q, asRole) => {
      // The disenchanter's two drops from one kill, a minute apart.
      const first = await importAs(asRole, OFFICER_T1, [
        row({ id: 'de-1', time: '22:00:00', response: 'Disenchant' }),
        row({ id: 'de-2', time: '22:01:00', response: 'Disenchant' })
      ]);
      expect(first.rows[0].result).toMatchObject({ inserted: 2, skipped_duplicate: 0 });
      // The same two from another officer's client: other ids, same awards.
      const again = await importAs(asRole, OFFICER_T1, [
        row({ id: 'other-de-1', time: '22:00:00', response: 'Disenchant' }),
        row({ id: 'other-de-2', time: '22:01:00', response: 'Disenchant' })
      ]);
      expect(again.rows[0].result).toMatchObject({ inserted: 0, skipped_duplicate: 2 });
      // A third copy, which neither award on file stands for, comes in.
      const third = await importAs(asRole, OFFICER_T1, [
        row({ id: 'other-de-1', time: '22:00:00' }),
        row({ id: 'other-de-2', time: '22:01:00' }),
        row({ id: 'other-de-3', time: '22:02:00' })
      ]);
      expect(third.rows[0].result).toMatchObject({ inserted: 1, skipped_duplicate: 2 });
    });
  });

  it('matches a boss on its letters and digits, so RCLootCouncil’s spelling finds the list’s', async () => {
    await withTxn(async (q, asRole) => {
      await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
               values (9310, 99310, 'Comma Raid', 'MID1', 0)`);
      await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
               values (9311, 9310, 3911, 'Chimaerus, the Undreamt God', 0)`);
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'comma-boss', itemID: 999999994, itemName: 'Not Loaded Yet', boss: 'Chimaerus the Undreamt God' })
      ]);
      expect(res.rows[0].result).toMatchObject({ inserted: 1, skipped_not_raid_gear: 0, unresolved_item: 1 });
    });
  });

  it('writes each award’s own season on its audit log entry', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({ id: 'audit-1', date: '2026/06/22', itemName: 'Audit One' }),
        row({ id: 'audit-2', date: '2026/09/01', itemName: 'Audit Two' })
      ]);
      const audit = await q(
        `select detail->>'summary' as summary, detail->>'season' as season from public.audit_log
          where team_id = 1 and action = 'Loot Imported (RCLC)' and detail->>'summary' like '%Audit%'
          order by detail->>'summary'`
      );
      expect(audit.rows).toEqual([
        { summary: 'Hero - Audit One', season: 'MID1' },
        { summary: 'Hero - Audit Two', season: 'MID2' }
      ]);
    });
  });

  it('leaves out an award already on file under another id or none, by character, item and time (#1579)', async () => {
    await withTxn(async (q, asRole) => {
      // The first history import's copy: no RCLootCouncil id.
      await q(
        `insert into public.rclc_loot (team_id, player_id, item_id, season, awarded_at)
         select 1, p.id, i.id, 'MID1', ('2026-06-22 22:00'::timestamp at time zone 'America/New_York')
           from public.players p, public.items i
          where p.team_id = 1 and p.name_realm = $1 and i.wow_item_id = $2`,
        [IMPORT_PLAYER_NAME, SEED_ITEM_WOW_ID]
      );
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'other-client', time: '22:03:00' }),
        row({ id: 'later-drop', time: '22:10:00' })
      ]);
      const result = res.rows[0].result;
      expect(result).toMatchObject({ inserted: 1, skipped_duplicate: 1 });
      expect(result.skipped).toEqual([
        {
          item: 'Seed Test Staff',
          boss: 'Some Boss',
          player: IMPORT_PLAYER_NAME,
          date: '2026-06-22',
          reason: 'already_on_file'
        }
      ]);
      const ids = await q(`select rclc_id from public.rclc_loot where rclc_id in ('other-client', 'later-drop')`);
      expect(ids.rows.map((r) => r.rclc_id)).toEqual(['later-drop']);
    });
  });

  it('rejects a raider (not officer/team leader)', async () => {
    await withTxn(async (q, asRole) => {
      await expect(importAs(asRole, RAIDER_T1, [row({ id: 'raider-blocked' })])).rejects.toThrow(/not authorized/i);
    });
  });

  it('allows a team leader', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, TEAM_LEADER_T1, [row({ id: 'leader-ok' })]);
      expect(res.rows[0].result.inserted).toBe(1);
    });
  });
});

afterAll(() => pool.end());
