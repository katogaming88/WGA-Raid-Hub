// #1633: the roster audit's season settings: the slots that take an enchant,
// the enchants and gems that count, and each crest's weekly cap. Reference
// rows added by migration; anyone reads them, nobody writes them.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const slotsOn = async (q, season, day) =>
  (await q('select public.season_enchant_slots_on($1, $2) as s', [season, day])).rows.map((r) => r.s);
const cap = async (q, track, week, season = 'MID2') =>
  (await q('select public.season_crest_cap($1, $2, $3) as c', [season, track, week])).rows[0].c;

describe('audit season settings', () => {
  it('Midnight Season 2 enchants weapons, head, shoulders, chest, legs, feet and both rings', async () => {
    await withTxn(async ({ q }) => {
      expect(await slotsOn(q, 'MID2', '2026-11-17')).toEqual([
        'CHEST',
        'FEET',
        'FINGER_1',
        'FINGER_2',
        'HEAD',
        'LEGS',
        'MAIN_HAND',
        'OFF_HAND',
        'SHOULDER'
      ]);
      expect(await slotsOn(q, 'MID1', '2026-05-01')).toEqual([]);
    });
  });

  it('a slot added mid-season is not expected before the day it starts counting', async () => {
    await withTxn(async ({ q }) => {
      await q(
        "insert into public.season_enchant_slots (season, slot, counts_from) values ('MID2', 'WRIST', '2026-12-01')"
      );
      expect(await slotsOn(q, 'MID2', '2026-11-30')).not.toContain('WRIST');
      expect(await slotsOn(q, 'MID2', '2026-12-01')).toContain('WRIST');
    });
  });

  it('holds both ranks of each enchant, the higher marked top, speed/leech/avoidance marked tertiary', async () => {
    await withTxn(async ({ q }) => {
      const ench = async (id) =>
        (
          await q(
            "select name, slot, top_rank, tertiary from public.season_enchants where season = 'MID2' and enchantment_id = $1",
            [id]
          )
        ).rows[0];
      expect(await ench(7986)).toEqual({
        name: 'Mark of the Worldsoul',
        slot: 'CHEST',
        top_rank: false,
        tertiary: false
      });
      expect(await ench(7987)).toEqual({
        name: 'Mark of the Worldsoul',
        slot: 'CHEST',
        top_rank: true,
        tertiary: false
      });
      expect(await ench(8027)).toMatchObject({ slot: 'FINGER', top_rank: true, tertiary: false });
      expect(await ench(7991)).toMatchObject({ name: 'Empowered Blessing of Speed', slot: 'HEAD', tertiary: true });
      expect(await ench(8018)).toMatchObject({ name: "Farstrider's Hunt", slot: 'FEET', tertiary: true });
      // Temporary oils and tool enchants never count.
      expect(await ench(8051)).toBeUndefined();
      expect(await ench(7974)).toBeUndefined();
      // Every enchant comes in two ranks, one top.
      const ranks = await q(
        `select name, count(*)::int as n, count(*) filter (where top_rank)::int as top
           from public.season_enchants where season = 'MID2' group by name having count(*) <> 2 or count(*) filter (where top_rank) <> 1`
      );
      expect(ranks.rows).toEqual([]);
    });
  });

  it('marks Flawless gems top rank and the diamonds epic', async () => {
    await withTxn(async ({ q }) => {
      const gem = async (id) =>
        (
          await q("select name, top_rank, epic from public.season_gems where season = 'MID2' and wow_item_id = $1", [
            id
          ])
        ).rows[0];
      expect(await gem(240912)).toEqual({ name: 'Flawless Versatile Lapis', top_rank: true, epic: false });
      expect(await gem(240880)).toEqual({ name: 'Versatile Lapis', top_rank: false, epic: false });
      expect(await gem(240967)).toEqual({ name: 'Powerful Eversong Diamond', top_rank: true, epic: true });
    });
  });

  it('a crest cap grows 100 a week from the first week, and is lifted from the lift date', async () => {
    await withTxn(async ({ q }) => {
      expect(await cap(q, 'Myth', '2026-08-11')).toBe(0);
      expect(await cap(q, 'Myth', '2026-08-18')).toBe(100);
      expect(await cap(q, 'Myth', '2026-08-25')).toBe(200);
      expect(await cap(q, 'Hero', '2026-10-13')).toBe(900);
      expect(await cap(q, 'Hero', '2026-10-20')).toBeNull();
      expect(await cap(q, 'Adventurer', '2026-11-17')).toBeNull();
      // An uncapped crest has none; a season with no rows answers nothing.
      await q("update public.season_crests set capped = false where season = 'MID2' and track = 'Veteran'");
      expect(await cap(q, 'Veteran', '2026-09-01')).toBeNull();
      expect(await cap(q, 'Myth', '2026-09-01', 'MID1')).toBeNull();
    });
  });

  it('anyone reads them, signed in or not; nobody writes them from the site', async () => {
    await withTxn(async ({ asAnon, asUser }) => {
      for (const t of ['season_enchant_slots', 'season_enchants', 'season_gems', 'season_crests']) {
        expect((await asAnon(`select count(*)::int as n from public.${t}`)).rows[0].n).toBeGreaterThan(0);
        expect((await asUser(RAIDER_T1, `select count(*)::int as n from public.${t}`)).rows[0].n).toBeGreaterThan(0);
      }
      expect(await cap(asAnon, 'Myth', '2026-08-18')).toBe(100);
      await expect(
        asUser(OFFICER_T1, "insert into public.season_enchant_slots (season, slot) values ('MID2', 'WRIST')")
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(OFFICER_T1, "update public.season_crests set capped = false where season = 'MID2'")
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});
