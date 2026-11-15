// #1637: the Great Vault worked out from the weekly row. Each row (Raid,
// Dungeons, World) has three slots; a filled slot offers the weakest reward
// among the runs it counts, an empty one says how many runs are left. The
// rewards, thresholds and counted raids are Season 2's settings.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const ABYSS = 1320;
const ABYSS_BOSSES = [2888, 2874, 2894, 2882, 2871, 2887, 2883, 2895];
const kill = (encounter_id, difficulty, instance_id = ABYSS) => ({ encounter_id, instance_id, difficulty });
const runs = (...levels) => levels.map((level, i) => ({ dungeon_id: 500 + i, level, timed: true }));

const vault = async (q, kills, mplus, delves, season = 'MID2') =>
  (
    await q('select public.season_vault($1, $2::jsonb, $3::jsonb, $4::jsonb) as v', [
      season,
      JSON.stringify(kills),
      JSON.stringify(mplus),
      delves === null ? null : JSON.stringify(delves)
    ])
  ).rows[0].v;

const filled = (needs, done, track, rank, item_level) => ({ needs, done, track, rank, item_level });
const empty = (needs, done) => ({ needs, done, left: needs - done });

describe('season_vault', () => {
  it("Katorrí's week: Mythic 3 and Heroic 8, six keys with a +12 best, four delves", async () => {
    await withTxn(async ({ q }) => {
      const kills = [
        ...ABYSS_BOSSES.slice(0, 3).map((id) => kill(id, 'mythic')),
        ...ABYSS_BOSSES.map((id) => kill(id, 'heroic'))
      ];
      expect(await vault(q, kills, runs(12, 12, 11, 10, 10, 9), { 11: 2, 8: 2 })).toEqual({
        raid: [filled(2, 11, 'Myth', 6, 334), filled(4, 11, 'Myth', 1, 318), filled(6, 11, 'Myth', 1, 318)],
        dungeon: [filled(1, 6, 'Myth', 1, 318), filled(4, 6, 'Myth', 1, 318), empty(8, 6)],
        world: [filled(2, 4, 'Hero', 1, 305), filled(4, 4, 'Hero', 1, 305), empty(8, 4)]
      });
    });
  });

  it('a slot offers the weakest reward among the runs it counts', async () => {
    await withTxn(async ({ q }) => {
      const v = await vault(q, [], runs(12, 7, 4, 2, 2), { 1: 1, 5: 3 });
      expect(v.dungeon).toEqual([filled(1, 5, 'Myth', 1, 318), filled(4, 5, 'Hero', 1, 305), empty(8, 5)]);
      expect(v.world).toEqual([filled(2, 4, 'Champion', 1, 292), filled(4, 4, 'Veteran', 1, 279), empty(8, 4)]);
      expect(v.raid).toEqual([empty(2, 0), empty(4, 0), empty(6, 0)]);
    });
  });

  it('the last two Mythic bosses offer Myth 9/6 only when every kill the slot counts is one of them', async () => {
    await withTxn(async ({ q }) => {
      const last = [kill(2883, 'mythic'), kill(2895, 'mythic')];
      expect((await vault(q, last, [], {})).raid[0]).toEqual(filled(2, 2, 'Myth', 9, 344));
      expect((await vault(q, [...last, kill(2888, 'mythic')], [], {})).raid[0]).toEqual(filled(2, 3, 'Myth', 9, 344));
      expect((await vault(q, [kill(2883, 'mythic'), kill(2888, 'mythic')], [], {})).raid[0]).toEqual(
        filled(2, 2, 'Myth', 6, 334)
      );
      expect((await vault(q, [kill(2883, 'heroic'), kill(2895, 'heroic')], [], {})).raid[0]).toEqual(
        filled(2, 2, 'Myth', 1, 318)
      );
    });
  });

  it("kills in this season's two raids count; an older raid's do not", async () => {
    await withTxn(async ({ q }) => {
      const v = await vault(q, [kill(2849, 'normal', 1317), kill(2888, 'lfr'), kill(2639, 'mythic', 1296)], [], {});
      expect(v.raid[0]).toEqual(filled(2, 2, 'Champion', 1, 292));
    });
  });

  it('unknown delves this week leave the World row unknown', async () => {
    await withTxn(async ({ q }) => {
      expect((await vault(q, [], [], null)).world).toBeNull();
    });
  });
});

describe('the weekly row works out its vault on every write', () => {
  const write = (q, week, delves) =>
    q(
      `insert into public.character_weeks (name_realm, week_of, mplus_runs, delves)
       values ('Katorrí-Stormrage', $1, $2::jsonb, $3::jsonb)
       on conflict (name_realm_key, week_of) do update set delves = excluded.delves`,
      [week, JSON.stringify(runs(10)), JSON.stringify(delves)]
    );
  const read = async (q, week) =>
    (
      await q(
        "select vault, vault_at is not null as has_at from public.character_weeks where name_realm_key = 'katorrí-stormrage' and week_of = $1",
        [week]
      )
    ).rows[0];

  it("delves this week are this row's running totals less last week's", async () => {
    await withTxn(async ({ q }) => {
      await write(q, '2026-11-03', { 8: 10, 11: 5 });
      await write(q, '2026-11-10', { 8: 12, 11: 7 });
      const row = await read(q, '2026-11-10');
      expect(row.has_at).toBe(true);
      expect(row.vault.dungeon[0]).toEqual(filled(1, 1, 'Myth', 1, 318));
      expect(row.vault.world).toEqual([filled(2, 4, 'Hero', 1, 305), filled(4, 4, 'Hero', 1, 305), empty(8, 4)]);

      // A later sync in the same week works it out again.
      await write(q, '2026-11-10', { 8: 12, 11: 9 });
      expect((await read(q, '2026-11-10')).vault.world[2]).toEqual(empty(8, 6));
    });
  });

  it('with no row for the week before, the World row is unknown', async () => {
    await withTxn(async ({ q }) => {
      await write(q, '2026-10-27', { 8: 10 });
      await write(q, '2026-11-10', { 8: 12 });
      expect((await read(q, '2026-11-10')).vault.world).toBeNull();
    });
  });
});

describe('vault season settings', () => {
  it('anyone reads them; nobody but migrations writes them', async () => {
    await withTxn(async ({ asUser, asAnon, asRole }) => {
      const callers = [asAnon, (text) => asUser(RAIDER_T1, text), asRole('service_role', null)];
      for (const t of ['season_track_steps', 'season_vault_slots', 'season_vault_rewards', 'season_vault_raids']) {
        expect((await asAnon(`select count(*)::int as n from public.${t}`)).rows[0].n).toBeGreaterThan(0);
        // Each write is granted separately, so each is tried; the insert
        // copies no rows but is still refused before it runs.
        for (const as of callers) {
          for (const sql of [
            `insert into public.${t} select * from public.${t} limit 0`,
            `update public.${t} set season = season`,
            `delete from public.${t}`,
            `truncate public.${t}`
          ]) {
            await expect(as(sql)).rejects.toMatchObject({ code: RLS_DENIED });
          }
        }
      }
    });
  });
});
