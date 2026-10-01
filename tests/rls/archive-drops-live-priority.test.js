// #1383: removing a raider takes them off the live season's priority lists in
// the same step, whoever removes them. The Roster tab used to clear the ranks
// with a second call after the archive, aimed at the season the page had in
// view and with its result ignored, and a guild officer, who may remove a
// raider, could never make that call at all (#607). A raider removed from
// Hellfire on 2026-09-05 still held 26 live ranks three weeks later.
//
// The ranks now go with the archive itself, through a trigger on
// players.archived_at, so every path that archives a character drops them:
// archive_player(), an officer's direct update, the main swap, the signup
// promotion. Earlier tiers keep theirs as history. A Priority tab opened
// before the removal cannot save the raider back onto a live list, and the
// RCLootCouncil export leaves out an archived raider whatever the table holds.
import { describe, it, expect } from 'vitest';
import { withTxn, seedTeam, seedPlayer, seedSeason, GUILD_OFFICER } from './helpers.js';

async function liveSeason(q) {
  return (await q('select public.current_season() as code')).rows[0].code;
}

// A team of the test's own with two raiders, the one about to leave ranked
// above the one staying on item 1's Myth list, and alone on item 2's Hero list.
async function fixture(q) {
  const team = await seedTeam(q);
  const leaving = await seedPlayer(q, { teamId: team.teamId });
  const staying = await seedPlayer(q, { teamId: team.teamId });
  const season = await liveSeason(q);
  await q(
    `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
       ($1, $2, 1, 'Myth', 1, $3),
       ($1, $2, 1, 'Myth', 2, $4),
       ($1, $2, 2, 'Hero', 1, $3)`,
    [team.teamId, season, leaving, staying]
  );
  return { team, leaving, staying, season };
}

async function ranksHeldBy(q, playerId) {
  const res = await q(
    'select season, item_id, track, rank from public.priority_order where player_id = $1 order by season, item_id, track',
    [playerId]
  );
  return res.rows;
}

describe('archiving a raider drops their live priority ranks', () => {
  it("a team officer's archive_player() removes them", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, leaving } = await fixture(q);
      await asUser(team.officer.uid, "select public.archive_player($1, 'other', 'left the guild')", [leaving]);
      expect(await ranksHeldBy(q, leaving)).toEqual([]);
    });
  });

  // The priority write rule leaves guild officers out on purpose (#607), so a
  // delete made with their own rights would match nothing and say nothing.
  it("a guild officer's archive_player() removes them too", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { leaving } = await fixture(q);
      await asUser(GUILD_OFFICER, "select public.archive_player($1, 'other', 'left the guild')", [leaving]);
      expect(await ranksHeldBy(q, leaving)).toEqual([]);
    });
  });

  it("an officer's direct update of archived_at removes them", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, leaving } = await fixture(q);
      const res = await asUser(team.officer.uid, 'update public.players set archived_at = now() where id = $1', [
        leaving
      ]);
      expect(res.rowCount).toBe(1);
      expect(await ranksHeldBy(q, leaving)).toEqual([]);
    });
  });

  it("keeps the raider's ranks in an earlier tier", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, leaving } = await fixture(q);
      const earlier = `earlier-${team.teamId}`;
      await seedSeason(q, earlier);
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, $2, 1, 'Myth', 1, $3)`,
        [team.teamId, earlier, leaving]
      );
      await asUser(team.officer.uid, "select public.archive_player($1, 'other', 'left the guild')", [leaving]);
      expect(await ranksHeldBy(q, leaving)).toEqual([{ season: earlier, item_id: 1, track: 'Myth', rank: 1 }]);
    });
  });

  it("leaves the other raiders' live ranks where they were", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, leaving, staying, season } = await fixture(q);
      await asUser(team.officer.uid, "select public.archive_player($1, 'other', 'left the guild')", [leaving]);
      expect(await ranksHeldBy(q, staying)).toEqual([{ season, item_id: 1, track: 'Myth', rank: 2 }]);
    });
  });

  it('un-archiving, re-archiving and other updates remove nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, staying, season } = await fixture(q);
      const away = await seedPlayer(q, { teamId: team.teamId, archivedAt: new Date('2026-09-05T16:28:00Z') });
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id)
         values ($1, $2, 2, 'Hero', 2, $3)`,
        [team.teamId, season, away]
      );
      const officer = (text, params) => asUser(team.officer.uid, text, params);
      await officer('update public.players set archived_at = now() where id = $1', [away]);
      await officer('update public.players set archived_at = null where id = $1', [away]);
      await officer("update public.players set nickname = 'Stays' where id = $1", [staying]);
      expect(await ranksHeldBy(q, away)).toEqual([{ season, item_id: 2, track: 'Hero', rank: 2 }]);
      expect(await ranksHeldBy(q, staying)).toEqual([{ season, item_id: 1, track: 'Myth', rank: 2 }]);
    });
  });
});

describe('save_priority_order with a raider who is no longer on the roster', () => {
  async function withArchived(q) {
    const f = await fixture(q);
    const nameRealm = `Departed${f.team.teamId}-Illidan`;
    const away = await seedPlayer(q, {
      teamId: f.team.teamId,
      nameRealm,
      archivedAt: new Date('2026-09-05T16:28:00Z')
    });
    return { ...f, away, nameRealm };
  }

  it('refuses a live-season list that names them, and says who', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, staying, season, away, nameRealm } = await withArchived(q);
      await expect(
        asUser(team.officer.uid, "select public.save_priority_order($1, $2, 1, 'Myth', $3)", [
          team.teamId,
          season,
          JSON.stringify([staying, away])
        ])
      ).rejects.toThrow(new RegExp(`${nameRealm} is no longer on the roster`));
      expect(await ranksHeldBy(q, away)).toEqual([]);
    });
  });

  it("still saves an earlier tier's list that names them", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team, staying, away } = await withArchived(q);
      const earlier = `earlier-${team.teamId}`;
      await seedSeason(q, earlier);
      const res = await asUser(team.officer.uid, "select public.save_priority_order($1, $2, 1, 'Myth', $3) as saved", [
        team.teamId,
        earlier,
        JSON.stringify([staying, away])
      ]);
      expect(res.rows[0].saved).toBe(2);
    });
  });
});

describe('build_rclc_export with an archived raider on a live list', () => {
  // Inserted after the archive, as a save racing the removal would leave it,
  // since an archive by update would already have taken the rank away.
  it('leaves them out of the ranked list', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const season = await liveSeason(q);
      const stayingName = `Staying${team.teamId}-Illidan`;
      const staying = await seedPlayer(q, { teamId: team.teamId, nameRealm: stayingName });
      const away = await seedPlayer(q, {
        teamId: team.teamId,
        nameRealm: `Departed${team.teamId}-Illidan`,
        archivedAt: new Date('2026-09-05T16:28:00Z')
      });
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
           ($1, $2, 1, 'Myth', 1, $3),
           ($1, $2, 1, 'Myth', 2, $4)`,
        [team.teamId, season, away, staying]
      );
      const res = await asUser(team.officer.uid, "select public.build_rclc_export($1, $2, 'Myth') as export", [
        team.teamId,
        season
      ]);
      expect(res.rows[0].export.priority['100001'].M).toEqual([stayingName]);
    });
  });
});
