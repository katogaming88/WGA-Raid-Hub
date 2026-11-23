// Settings > Loot's access card (#1560, 20261122155302_loot_access_settings.sql).
// lootHistoryAccess decides who team_loot_history() (the Loot history page's
// read) answers; lootImportAccess decides who may add loot rows, which is
// what import_rclc_loot() does. Both default to today's access.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  OFFICER_T2,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  RLS_DENIED,
  seedSeason
} from './helpers.js';

afterAll(() => pool.end());

const SEASON = 'loot-access-test';
const ITEM_ID = 89500;

async function seed(t, config) {
  await seedSeason(t.q, SEASON);
  await t.q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 295000, 'Seed Access Ring', 'Finger')",
    [ITEM_ID]
  );
  await t.q("insert into public.rclc_loot (team_id, player_id, item_id, track, season) values (1, 1, $1, 'Myth', $2)", [
    ITEM_ID,
    SEASON
  ]);
  if (config) {
    await t.q(
      `insert into public.team_settings (team_id, config) values (1, $1::jsonb)
       on conflict (team_id) do update set config = public.team_settings.config || excluded.config`,
      [JSON.stringify(config)]
    );
  }
}

const history = (t, uid) =>
  t.asUser(uid, 'select item_name, slot from public.team_loot_history(1) where item_id = $1', [ITEM_ID]);

const addRow = (t, uid) =>
  t.asUser(uid, "insert into public.rclc_loot (team_id, item_id, track, season) values (1, $1, 'Hero', $2)", [
    ITEM_ID,
    SEASON
  ]);

// A refused write either matches no row (the rule hides the row) or is denied
// outright (42501, a role with no grant); any other error fails the test.
async function changesNothing(write) {
  let result;
  try {
    result = await write;
  } catch (err) {
    expect(err.code).toBe(RLS_DENIED);
    return;
  }
  expect(result.rowCount).toBe(0);
}

describe('loot history access (#1560)', () => {
  it('answers everyone by default, with the item and no player', () =>
    withTxn(async (t) => {
      await seed(t);
      const { rows } = await history(t, RAIDER_T1);
      expect(rows).toEqual([{ item_name: 'Seed Access Ring', slot: 'Finger' }]);
    }));

  it('refuses a raider once the team locks it to officers, and still answers officers', () =>
    withTxn(async (t) => {
      await seed(t, { lootHistoryAccess: 'officers' });
      await expect(history(t, RAIDER_T1)).rejects.toThrow(/Not authorized/);
      expect((await history(t, OFFICER_T1)).rows).toHaveLength(1);
      expect((await history(t, SITE_ADMIN)).rows).toHaveLength(1);
      expect((await history(t, TEAM_LEADER_T1)).rows).toHaveLength(1);
    }));

  it('refuses another team’s officer once the team locks it to officers', () =>
    withTxn(async (t) => {
      await seed(t, { lootHistoryAccess: 'officers' });
      await expect(history(t, OFFICER_T2)).rejects.toThrow(/Not authorized/);
    }));

  it('keeps the loot rows themselves readable (only the page is locked)', () =>
    withTxn(async (t) => {
      await seed(t, { lootHistoryAccess: 'officers' });
      const { rows } = await t.asUser(RAIDER_T1, 'select id from public.rclc_loot where item_id = $1', [ITEM_ID]);
      expect(rows).toHaveLength(1);
    }));

  it('leaves Home’s Recent loot feed alone: its own read still answers a raider and a visitor', () =>
    withTxn(async (t) => {
      await seed(t, { lootHistoryAccess: 'officers' });
      // The same read as app/src/home/useHome.ts useSeasonLoot(): rclc_loot
      // with the item and the player, filtered to the team and season.
      const feed = `select l.id, i.name, p.name_realm
                      from public.rclc_loot l
                      left join public.items i on i.id = l.item_id
                      left join public.players p on p.id = l.player_id
                     where l.team_id = 1 and l.season = $1`;
      for (const run of [(sql, args) => t.asUser(RAIDER_T1, sql, args), t.asAnon]) {
        const { rows } = await run(feed, [SEASON]);
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Seed Access Ring');
      }
    }));

  it('is not open to anon', () =>
    withTxn(async (t) => {
      await seed(t);
      await expect(t.asAnon('select * from public.team_loot_history(1)')).rejects.toThrow(/permission denied/);
    }));
});

describe('loot import access (#1560)', () => {
  it('lets officers add loot by default, never raiders', () =>
    withTxn(async (t) => {
      await seed(t);
      await addRow(t, OFFICER_T1);
      await expect(addRow(t, RAIDER_T1)).rejects.toMatchObject({ code: RLS_DENIED });
    }));

  it('leaves adding loot to the team leader and site admins when set to leader', () =>
    withTxn(async (t) => {
      await seed(t, { lootImportAccess: 'leader' });
      await expect(addRow(t, OFFICER_T1)).rejects.toMatchObject({ code: RLS_DENIED });
      await addRow(t, TEAM_LEADER_T1);
      await addRow(t, SITE_ADMIN);
    }));

  it('lets the same import through by default (the control for the case below)', () =>
    withTxn(async (t) => {
      await seed(t);
      const rows = [
        { player: 'Nobody-Test', id: 'rclc-access-1', itemID: 295000, date: '2026/11/20', time: '21:00:00' }
      ];
      const {
        rows: [res]
      } = await t.asUser(OFFICER_T1, 'select public.import_rclc_loot(1, $1, $2::jsonb)', [
        SEASON,
        JSON.stringify(rows)
      ]);
      expect(res.import_rclc_loot.inserted).toBe(1);
    }));

  it('lets the team leader’s own import through when set to leader', () =>
    withTxn(async (t) => {
      await seed(t, { lootImportAccess: 'leader' });
      const rows = [
        { player: 'Nobody-Test', id: 'rclc-access-2', itemID: 295000, date: '2026/11/20', time: '21:00:00' }
      ];
      const {
        rows: [res]
      } = await t.asUser(TEAM_LEADER_T1, 'select public.import_rclc_loot(1, $1, $2::jsonb)', [
        SEASON,
        JSON.stringify(rows)
      ]);
      expect(res.import_rclc_loot.inserted).toBe(1);
    }));

  it('opens locked loot history to an officer who manages loot without view_loot', () =>
    withTxn(async (t) => {
      await seed(t, { lootHistoryAccess: 'officers' });
      await t.q(
        `delete from public.team_rank_permissions where team_id = 1 and rank = 'officer' and permission = 'view_loot'`
      );
      expect((await history(t, OFFICER_T1)).rows).toHaveLength(1);
    }));

  it('refuses an officer’s import as a whole when set to leader', () =>
    withTxn(async (t) => {
      await seed(t, { lootImportAccess: 'leader' });
      const rows = [
        { player: 'Nobody-Test', id: 'rclc-access-1', itemID: 295000, date: '2026/11/20', time: '21:00:00' }
      ];
      await expect(
        t.asUser(OFFICER_T1, 'select public.import_rclc_loot(1, $1, $2::jsonb)', [SEASON, JSON.stringify(rows)])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    }));

  it('still lets officers change and remove loot rows when set to leader', () =>
    withTxn(async (t) => {
      await seed(t, { lootImportAccess: 'leader' });
      const upd = await t.asUser(OFFICER_T1, "update public.rclc_loot set track = 'Hero' where item_id = $1", [
        ITEM_ID
      ]);
      expect(upd.rowCount).toBe(1);
      const del = await t.asUser(OFFICER_T1, 'delete from public.rclc_loot where item_id = $1', [ITEM_ID]);
      expect(del.rowCount).toBe(1);
    }));

  it('refuses an import from another team’s officer and from a signed-out visitor', () =>
    withTxn(async (t) => {
      await seed(t);
      await expect(addRow(t, OFFICER_T2)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        t.asAnon("insert into public.rclc_loot (team_id, item_id, track, season) values (1, $1, 'Hero', $2)", [
          ITEM_ID,
          SEASON
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    }));

  it('changes and removes nothing for a raider, another team’s officer or a visitor', () =>
    withTxn(async (t) => {
      await seed(t, { lootImportAccess: 'leader' });
      const callers = [
        (sql, args) => t.asUser(RAIDER_T1, sql, args),
        (sql, args) => t.asUser(OFFICER_T2, sql, args),
        t.asAnon
      ];
      for (const run of callers) {
        await changesNothing(run("update public.rclc_loot set track = 'Hero' where item_id = $1", [ITEM_ID]));
        await changesNothing(run('delete from public.rclc_loot where item_id = $1', [ITEM_ID]));
      }
      const { rows } = await t.q('select track from public.rclc_loot where item_id = $1', [ITEM_ID]);
      expect(rows).toEqual([{ track: 'Myth' }]);
    }));
});

describe('a loot row stays on its team (#1560, CodeRabbit)', () => {
  it('stops an officer on two teams moving a row into a team set to leader only', () =>
    withTxn(async (t) => {
      await seed(t);
      await t.q(
        `insert into public.team_settings (team_id, config) values (2, '{"lootImportAccess":"leader"}'::jsonb)
         on conflict (team_id) do update set config = public.team_settings.config || excluded.config`
      );
      // OFFICER_T1 is made an officer of team 2 as well, so both rules let them in.
      await t.q(
        `insert into public.team_members (team_id, discord_id, role, person_id)
         select 2, discord_id || '-t2', 'officer', person_id from public.team_members
          where team_id = 1 and person_id = (select id from public.people where auth_user_id = $1)`,
        [OFFICER_T1]
      );
      const { rows } = await t.asUser(
        OFFICER_T1,
        "insert into public.rclc_loot (team_id, item_id, track, season) values (1, $1, 'Hero', $2) returning id",
        [ITEM_ID, SEASON]
      );
      await expect(
        t.asUser(OFFICER_T1, 'update public.rclc_loot set team_id = 2 where id = $1', [rows[0].id])
      ).rejects.toMatchObject({ code: RLS_DENIED, message: 'A loot row stays on its team' });
    }));

  it('still lets a site admin move a row', () =>
    withTxn(async (t) => {
      await seed(t);
      const upd = await t.asUser(
        SITE_ADMIN,
        'update public.rclc_loot set team_id = 2, player_id = null where item_id = $1',
        [ITEM_ID]
      );
      expect(upd.rowCount).toBe(1);
    }));
});
