// What gets counted as loot received (#1561 part 3,
// 20261020123059_loot_responses_priority.sql): Suggest order
// (generate_priority_order()) and the RCLootCouncil export
// (build_rclc_export()) count an award as owned only when the team's saved
// button list says its response is Main spec. With no list saved, each keeps
// its rule from before: Suggest order skips OS and M+ rolls, the export
// counts every award. loot_response_counts_as() answers for one response.
//
// #1585 (20261128123627_loot_counts_one_rule.sql): loot_award_counts_as()
// is the saved list or, with none, today's rule (todaysCountsAs() in the new
// app), so Suggest order and the three loot reports also leave out
// Disenchant, Bonus Loot, Personal Loot, Xmog and Pet for a team with no list.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn as withSharedTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1, seedSeason } from './helpers.js';

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
const award = (q, response, awardedAt = '2026-09-01T02:00:00Z') =>
  q(
    `insert into public.rclc_loot (team_id, player_id, item_id, track, season, response, awarded_at)
     values (1, 1, $1, 'Hero', $2, $3, $4)`,
    [ITEM_ID, SEASON, response, awardedAt]
  );

// The five responses that never count without a saved list (#1585).
const NOT_COUNTED = ['Disenchant', 'Bonus Loot', 'Personal Loot - Non tradeable', 'Xmog', 'Pet'];

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

describe('loot_award_counts_as (#1585)', () => {
  it('with no list, follows today’s rule, as the new app does', async () => {
    await withTxn(async ({ asUser }) => {
      const read = async (response) =>
        (await asUser(OFFICER_T1, 'select public.loot_award_counts_as(1, $1) as c', [response])).rows[0].c;
      expect(await read('Xmog')).toBe('hidden');
      expect(await read(' pet ')).toBe('hidden');
      expect(await read('Bonus Loot')).toBe('none');
      expect(await read('Personal Loot - Non tradeable')).toBe('none');
      expect(await read('disenchant')).toBe('none');
      expect(await read('OS')).toBe('off');
      expect(await read('M+ upgrade')).toBe('off');
      expect(await read('Upgrade')).toBe('main');
      expect(await read(null)).toBe('main');
      expect(await read('')).toBe('main');
    });
  });

  it('with a list, the list answers', async () => {
    await withTxn(async ({ q, asUser }) => {
      await saveList(q, LIST);
      const read = async (response) =>
        (await asUser(OFFICER_T1, 'select public.loot_award_counts_as(1, $1) as c', [response])).rows[0].c;
      expect(await read('Offspec/Greed')).toBe('off');
      expect(await read('Bonus Loot')).toBe('hidden');
      expect(await read('Upgrade')).toBe('main');
    });
  });
});

describe('generate_priority_order follows the button list', () => {
  it('with no list, a Disenchant, Bonus Loot, Personal Loot, Xmog or Pet win leaves the raider in (#1585)', async () => {
    for (const response of NOT_COUNTED) {
      await withTxn(async ({ q, asUser }) => {
        await award(q, response);
        expect(await suggested(asUser), response).toContain(1);
      });
    }
  });

  it('with no list, a win with no response (older imports) takes only that raider out', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await suggested(asUser)).toEqual(expect.arrayContaining([1, 2]));
      await award(q, null);
      const ids = await suggested(asUser);
      expect(ids).not.toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('is refused to another team’s officer, a raider and a signed-out caller', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      const args = [SEASON, ITEM_ID, 'Hero'];
      const call = 'select player_id from public.generate_priority_order(1, $1, $2, $3)';
      await expect(asUser(OFFICER_T2, call, args)).rejects.toThrow(/not authorized/i);
      await expect(asUser(RAIDER_T1, call, args)).rejects.toThrow(/not authorized/i);
      await expect(asAnon(call, args)).rejects.toThrow(/permission denied/i);
    });
  });

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

describe('the loot reports leave out what is not loot received (#1585)', () => {
  it('Raid nights since last item: a later Disenchant win does not reset the count; a win with no response does', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Later than any seeded award for player 1.
      await award(q, null, '2027-01-05T02:00:00Z');
      await award(q, 'Disenchant', '2027-01-12T02:00:00Z');
      await award(q, 'Bonus Loot', '2027-01-13T02:00:00Z');
      const res = await asUser(OFFICER_T1, 'select last_award_at from public.rnlsi where player_id = 1');
      expect(res.rows[0].last_award_at.toISOString()).toBe('2027-01-05T02:00:00.000Z');
    });
  });

  it('Loot pace counts a win with no response and an off spec win, not the five', async () => {
    await withTxn(async ({ q, asUser }) => {
      const total = async () =>
        (
          await asUser(
            OFFICER_T1,
            'select coalesce(sum(items_awarded), 0)::int as n from public.season_loot_pace where team_id = 1 and season = $1',
            [SEASON]
          )
        ).rows[0].n;
      await award(q, null);
      expect(await total()).toBe(1);
      await award(q, 'OS');
      expect(await total()).toBe(2);
      for (const response of NOT_COUNTED) {
        await award(q, response);
        expect(await total(), response).toBe(2);
      }
    });
  });

  it('Loot pace still starts Week 1 at the first award logged, even one it leaves out', async () => {
    await withTxn(async ({ q, asUser }) => {
      // A disenchant on the first night, a real award eight days later.
      await award(q, 'Disenchant', '2026-09-01T02:00:00Z');
      await award(q, null, '2026-09-09T02:00:00Z');
      const res = await asUser(
        OFFICER_T1,
        'select season_week, items_awarded::int as n from public.season_loot_pace where team_id = 1 and season = $1',
        [SEASON]
      );
      expect(res.rows).toEqual([{ season_week: 2, n: 1 }]);
    });
  });

  it('BiS demand counts a win with no response as awarded, not a Disenchant one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const awarded = async () =>
        (
          await asUser(
            OFFICER_T1,
            'select awarded_count::int as n from public.bis_demand_vs_awards where team_id = 1 and item_id = $1 and season = $2',
            [ITEM_ID, SEASON]
          )
        ).rows[0].n;
      await award(q, null);
      expect(await awarded()).toBe(1);
      await award(q, 'Disenchant');
      expect(await awarded()).toBe(1);
    });
  });

  it('can be read signed out, as before: the views grant anon and call the rule as their caller', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await award(q, 'Disenchant');
      for (const view of ['rnlsi', 'season_loot_pace', 'bis_demand_vs_awards']) {
        await expect(asAnon(`select count(*) from public.${view}`), view).resolves.toBeDefined();
      }
    });
  });

  it('follows the saved list when there is one', async () => {
    await withTxn(async ({ q, asUser }) => {
      await saveList(q, LIST);
      await award(q, 'Upgrade');
      await award(q, 'Offspec/Greed');
      await award(q, 'Disenchant');
      await award(q, 'Transmog');
      const res = await asUser(
        OFFICER_T1,
        'select sum(items_awarded)::int as n from public.season_loot_pace where team_id = 1 and season = $1',
        [SEASON]
      );
      expect(res.rows[0].n).toBe(2);
    });
  });
});
