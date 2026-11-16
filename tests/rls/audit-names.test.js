// #1641: names for the audit's Raids and Dungeons tabs. The weekly row stores
// bosses and dungeons by Blizzard's ids; these reference tables say what they
// are called. Anyone reads them, nobody writes them but migrations.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

describe('season_raid_bosses', () => {
  it('lists every boss of Season 2’s counted raids in the game’s order, The Venomous Abyss first', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        `select b.instance_id, b.encounter_id, b.name
           from public.season_raid_bosses b
          where b.season = 'MID2'
          order by (b.instance_id <> 1320), b.sort_order`
      );
      expect(rows.length).toBe(10);
      expect(rows.slice(0, 8).map((r) => r.encounter_id)).toEqual([2888, 2874, 2894, 2882, 2871, 2887, 2883, 2895]);
      expect(rows[0]).toMatchObject({ instance_id: 1320, name: 'Nek’zali the Soulcoiler'.replace('’', "'") });
      expect(rows[7].name).toBe('Ula’tek'.replace('’', "'"));
    });
  });

  it('every boss belongs to a raid the vault counts that season', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        `select count(*)::int as n from public.season_raid_bosses b
          where not exists (select 1 from public.season_vault_raids r
                             where r.season = b.season and r.instance_id = b.instance_id)`
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('Kith’ix', () => {
  it('is the tenth boss, in a raid of its own that the vault counts', async () => {
    await withTxn(async ({ q }) => {
      const boss = (
        await q('select instance_id, name, sort_order from public.season_raid_bosses where encounter_id = 2896')
      ).rows[0];
      expect(boss).toMatchObject({ instance_id: 1324, sort_order: 10 });
      const raid = (await q("select name from public.season_vault_raids where season = 'MID2' and instance_id = 1324"))
        .rows[0];
      expect(raid).toBeTruthy();
    });
  });

  it('a Kith’ix kill fills a Raid vault slot like any other boss', async () => {
    await withTxn(async ({ q }) => {
      const kills = [
        { encounter_id: 2896, instance_id: 1324, difficulty: 'heroic' },
        { encounter_id: 2888, instance_id: 1320, difficulty: 'heroic' }
      ];
      const { rows } = await q('select public.season_vault($1, $2::jsonb, $3::jsonb, $4::jsonb) as v', [
        'MID2',
        JSON.stringify(kills),
        '[]',
        '{}'
      ]);
      // Two bosses fill the first slot; without Kith'ix there would be one.
      expect(rows[0].v.raid[0]).toMatchObject({ needs: 2, done: 2 });
      expect(rows[0].v.raid[0].item_level).toBeGreaterThan(0);
    });
  });

  it('no two bosses of a season share a place in the order', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q(
          "insert into public.season_raid_bosses (season, instance_id, encounter_id, name, sort_order) values ('MID2', 1324, 99999, 'X', 10)"
        )
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('mplus_dungeons', () => {
  it('names the dungeons by the id the profile API uses', async () => {
    await withTxn(async ({ q }) => {
      const name = async (id) =>
        (await q('select name from public.mplus_dungeons where dungeon_id = $1', [id])).rows[0]?.name;
      expect(await name(525)).toBe('Operation: Floodgate');
      expect(await name(558)).toBe('Magisters’ Terrace'.replace('’', "'"));
    });
  });
});

describe('who can read and write them', () => {
  it('anyone reads, signed out included', async () => {
    await withTxn(async ({ asAnon }) => {
      expect((await asAnon('select count(*)::int as n from public.season_raid_bosses')).rows[0].n).toBe(10);
      expect((await asAnon('select count(*)::int as n from public.mplus_dungeons')).rows[0].n).toBeGreaterThan(50);
    });
  });

  it.each([
    ['a raider', RAIDER_T1],
    ['an officer', OFFICER_T1]
  ])('%s cannot write either table', async (_who, uid) => {
    await withTxn(async ({ asUser }) => {
      for (const sql of [
        "insert into public.mplus_dungeons (dungeon_id, name) values (99999, 'X')",
        "update public.mplus_dungeons set name = 'X'",
        'delete from public.mplus_dungeons',
        "update public.season_raid_bosses set name = 'X'",
        'delete from public.season_raid_bosses',
        'truncate public.season_raid_bosses',
        'truncate public.mplus_dungeons'
      ]) {
        await expect(asUser(uid, sql)).rejects.toMatchObject({ code: RLS_DENIED });
      }
    });
  });
});
