// What gets counted as loot received (#1561 part 3,
// 20261020123059_loot_responses_priority.sql): Suggest order
// (generate_priority_order()) and the RCLootCouncil export
// (build_rclc_export()) count an award as owned only when the team's saved
// button list says its response is Main spec. With no list saved, each keeps
// its rule from before: Suggest order skips OS and M+ rolls, the export
// counts every award. loot_response_counts_as() answers for one response.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn as withSharedTxn, OFFICER_T1, seedSeason } from './helpers.js';

afterAll(() => pool.end());

const SEASON = 'loot-responses-priority-test';
const ITEM_ID = 89400;
const WOW_ITEM_ID = 294000;

const LIST = {
  buttons: [
    { text: 'Upgrade', countsAs: 'main' },
    { text: 'Offspec/Greed', countsAs: 'off' }
  ],
  groups: [{ name: 'Armor Token', buttons: [{ text: '2/4 Set', countsAs: 'main' }] }]
};

// Players 1 and 2 both mark the item BiS with scores, so both are candidates
// until an award takes one out.
async function withTxn(fn) {
  return withSharedTxn(async (t) => {
    await seedSeason(t.q, SEASON);
    await t.q(
      "insert into public.items (id, wow_item_id, name, slot) values ($1, $2, 'Seed Response Ring', 'Finger')",
      [ITEM_ID, WOW_ITEM_ID]
    );
    for (const player of [1, 2]) {
      await t.q(
        'insert into public.scoring (player_id, team_id, season, performance_score, attendance_score) values ($1, 1, $2, 100, 100)',
        [player, SEASON]
      );
      await t.q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, $2, 'bis', $3)",
        [player, ITEM_ID, SEASON]
      );
    }
    return fn(t);
  });
}

const saveList = (q, list) =>
  q(
    `insert into public.team_settings (team_id, config) values (1, jsonb_build_object('lootResponses', $1::jsonb))
     on conflict (team_id) do update set config = public.team_settings.config || excluded.config`,
    [JSON.stringify(list)]
  );

// Player 1 won the item on Heroic under this response.
const award = (q, response) =>
  q(
    "insert into public.rclc_loot (team_id, player_id, item_id, track, season, response) values (1, 1, $1, 'Hero', $2, $3)",
    [ITEM_ID, SEASON, response]
  );

const suggested = async (asUser) =>
  (
    await asUser(OFFICER_T1, 'select player_id from public.generate_priority_order(1, $1, $2, $3)', [
      SEASON,
      ITEM_ID,
      'Hero'
    ])
  ).rows.map((r) => r.player_id);

describe('loot_response_counts_as', () => {
  it('reads the list ignoring case and spaces, group buttons alike; fixed rows are none, unlisted is hidden', async () => {
    await withTxn(async ({ q, asUser }) => {
      await saveList(q, LIST);
      const read = async (response) =>
        (await asUser(OFFICER_T1, 'select public.loot_response_counts_as(1, $1) as c', [response])).rows[0].c;
      expect(await read(' upgrade ')).toBe('main');
      expect(await read('2/4 SET')).toBe('main');
      expect(await read('Offspec/Greed')).toBe('off');
      expect(await read('Disenchant')).toBe('none');
      expect(await read('Transmog')).toBe('hidden');
      expect(await read(null)).toBe('main');
    });
  });

  it('answers null for a team with no list saved', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(OFFICER_T1, 'select public.loot_response_counts_as(1, $1) as c', ['Upgrade']);
      expect(res.rows[0].c).toBeNull();
    });
  });
});

describe('generate_priority_order follows the button list', () => {
  it('with no list, an OS roll does not take a raider out, and "Offspec/Greed" does (as before)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await award(q, 'OS');
      expect(await suggested(asUser)).toContain(1);
    });
    await withTxn(async ({ q, asUser }) => {
      await award(q, 'Offspec/Greed');
      expect(await suggested(asUser)).not.toContain(1);
    });
  });

  it('with a list, an Off spec or unlisted win leaves the raider in; a Main spec win takes them out', async () => {
    for (const [response, kept] of [
      ['Offspec/Greed', true],
      ['Pet', true],
      ['upgrade', false],
      ['2/4 Set', false]
    ]) {
      await withTxn(async ({ q, asUser }) => {
        await saveList(q, LIST);
        await award(q, response);
        const ids = await suggested(asUser);
        expect(ids.includes(1), response).toBe(kept);
        expect(ids).toContain(2);
      });
    }
  });
});

describe('build_rclc_export follows the button list', () => {
  const exported = async (q, asUser) => {
    await q(
      `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
         (1, $1, $2, 'Hero', 1, 1), (1, $1, $2, 'Hero', 2, 2)`,
      [SEASON, ITEM_ID]
    );
    const res = await asUser(OFFICER_T1, 'select public.build_rclc_export(1, $1, $2) as payload', [SEASON, 'Hero']);
    return res.rows[0].payload.priority[String(WOW_ITEM_ID)].H;
  };

  it('with no list, any win drops the raider from the Heroic list (as before)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await award(q, 'Offspec/Greed');
      expect(await exported(q, asUser)).toEqual(['Seedplayertwo-Illidan']);
    });
  });

  it('with a list, only a Main spec win drops them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await saveList(q, LIST);
      await award(q, 'Offspec/Greed');
      expect(await exported(q, asUser)).toEqual(['Seedraider-Illidan', 'Seedplayertwo-Illidan']);
    });
    await withTxn(async ({ q, asUser }) => {
      await saveList(q, LIST);
      await award(q, 'Upgrade');
      expect(await exported(q, asUser)).toEqual(['Seedplayertwo-Illidan']);
    });
  });
});
