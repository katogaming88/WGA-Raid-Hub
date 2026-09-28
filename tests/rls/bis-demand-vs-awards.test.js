// bis_demand_vs_awards: the Reports tab's BiS demand table. Demand is how many
// active raiders on a team have an item tagged BiS in a season, awards how
// many times RCLC handed it out on the team in that season, and since #1268
// the two meet only in their own season. Uses the shared withTxn from
// helpers.js; every item is minted here, so the seed's own loot row never
// reaches a count.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer } from './helpers.js';

const item = async (q, source = 'raid') =>
  (
    await q("insert into public.items (name, slot, source) values ($1, 'Chest', $2) returning id", [
      `Demand Test ${randomUUID().slice(0, 8)}`,
      source
    ])
  ).rows[0].id;

const want = (q, playerId, itemId, season, status = 'bis') =>
  q('insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, $2, $3, $4)', [
    playerId,
    itemId,
    status,
    season
  ]);

const award = (q, itemId, season) =>
  q('insert into public.rclc_loot (team_id, item_id, season) values (1, $1, $2)', [itemId, season]);

async function rowsFor(q, itemId) {
  const res = await q(
    `select season, demand_count::int as demand, awarded_count::int as awarded
       from public.bis_demand_vs_awards where team_id = 1 and item_id = $1 order by season`,
    [itemId]
  );
  return res.rows;
}

describe('bis_demand_vs_awards counts one season at a time (#1268)', () => {
  it("counts each season's BiS picks on their own", async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      const b = await seedPlayer(q, { teamId: 1 });
      const drape = await item(q);
      await want(q, a, drape, 'MID1');
      await want(q, a, drape, 'MID2');
      await want(q, b, drape, 'MID2');
      expect(await rowsFor(q, drape)).toEqual([
        { season: 'MID1', demand: 1, awarded: 0 },
        { season: 'MID2', demand: 2, awarded: 0 }
      ]);
    });
  });

  it('meets an award with the demand of its own season', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      const b = await seedPlayer(q, { teamId: 1 });
      const drape = await item(q);
      await want(q, a, drape, 'MID1');
      await want(q, a, drape, 'MID2');
      await want(q, b, drape, 'MID2');
      await award(q, drape, 'MID1');
      await award(q, drape, 'MID1');
      await award(q, drape, 'MID2');
      expect(await rowsFor(q, drape)).toEqual([
        { season: 'MID1', demand: 1, awarded: 2 },
        { season: 'MID2', demand: 2, awarded: 1 }
      ]);
    });
  });

  // Decided on #1268: the report answers how much of what raiders want has
  // been handed out, so an award with no BiS pick in its season is not listed
  // there, the way an award nobody ever wanted never has been.
  it('leaves out an item handed out in a season nobody wants it in', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      const wantedLater = await item(q);
      await want(q, a, wantedLater, 'MID2');
      await award(q, wantedLater, 'MID1');
      const neverWanted = await item(q);
      await award(q, neverWanted, 'MID2');
      expect(await rowsFor(q, wantedLater)).toEqual([{ season: 'MID2', demand: 1, awarded: 0 }]);
      expect(await rowsFor(q, neverWanted)).toEqual([]);
    });
  });

  it('counts a pick with no season in no season', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedPlayer(q, { teamId: 1 });
      const drape = await item(q);
      await want(q, a, drape, null);
      expect(await rowsFor(q, drape)).toEqual([]);
    });
  });

  // Unchanged by #1268; the view is rewritten around it.
  it("counts only an active raider's BiS pick on a raid drop", async () => {
    await withTxn(async ({ q }) => {
      const active = await seedPlayer(q, { teamId: 1 });
      const archived = await seedPlayer(q, { teamId: 1, archivedAt: new Date().toISOString() });
      const raidDrop = await item(q);
      const dungeonDrop = await item(q, 'dungeon');
      await want(q, archived, raidDrop, 'MID2');
      await want(q, active, raidDrop, 'MID2', 'good');
      await want(q, active, dungeonDrop, 'MID2');
      expect(await rowsFor(q, raidDrop)).toEqual([]);
      expect(await rowsFor(q, dungeonDrop)).toEqual([]);
    });
  });
});

afterAll(() => pool.end());
