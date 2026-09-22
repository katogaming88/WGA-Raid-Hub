// team_season_start (#1269): the day a team's season starts, derived rather
// than typed. The earliest raid night the sync filed from a Warcraft Logs
// report for that team inside the tier (an officer-excluded night is skipped,
// a row an officer typed by hand is not a report), else the tier's own start.
// SECURITY INVOKER over two public-read tables, so anon may call it; the tier
// argument defaults to current_season().
//
// Every case mints its own team and tier (#1123). A seeded tier is one day
// wide (seedSeason sets starts_at = ends_at), so the window cases widen it.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTxn, seedTeam, seedPlayer, seedSeason } from './helpers.js';

const tier = () => `T${randomUUID().replace(/-/g, '').slice(0, 6)}`;
const start = (teamId, season) => ['select public.team_season_start($1, $2)::text as day', [teamId, season]];

// A date n days after a seeded tier's day.
const plus = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);

// Widens a one-day seeded tier to a week.
const widen = (q, season) => q('update public.seasons set ends_at = starts_at + 6 where code = $1', [season]);

// One attendance row. A synced night carries the report it came from; a
// typed one carries nothing.
async function night(q, teamId, playerId, day, { report = 'RPT', excluded = false, source = 'WCL' } = {}) {
  await q(
    `insert into public.attendance (team_id, player_id, raid_date, status, report_id, report_excluded, source)
     values ($1, $2, $3::date, 'Present', $4, $5, $6)`,
    [teamId, playerId, day, report, excluded, source]
  );
}

describe('team_season_start', () => {
  it('answers the tier start when the team has no synced night in it', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day }]);
    });
  });

  it('answers the earliest synced night inside the tier', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, plus(day, 4));
      await night(q, team.teamId, player, plus(day, 2));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day: plus(day, 2) }]);
    });
  });

  it('skips a night an officer excluded', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, plus(day, 1), { excluded: true });
      await night(q, team.teamId, player, plus(day, 3));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day: plus(day, 3) }]);
    });
  });

  it('ignores a row an officer typed by hand, which is not a report', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, plus(day, 1), { report: null, source: 'Officer' });
      await night(q, team.teamId, player, plus(day, 5));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day: plus(day, 5) }]);
    });
  });

  it('ignores a night before the tier started', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, plus(day, -1));
      await night(q, team.teamId, player, plus(day, 3));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day: plus(day, 3) }]);
    });
  });

  it('ignores a night after the tier ended, and answers the tier start with nothing inside', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, plus(day, 7));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day }]);
    });
  });

  // An open-ended tier is always the last one (seasons_no_overlap), so its
  // window has no upper bound. The seed's MID2 is that tier; a minted one
  // opened to null would overlap it.
  it('counts every night after the start of the open-ended tier', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, '2030-01-01');
      const res = await q(...start(team.teamId, 'MID2'));
      expect(res.rows).toEqual([{ day: '2030-01-01' }]);
    });
  });

  it("reads one team's nights only", async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      await widen(q, season);
      const player = await seedPlayer(q, { teamId: other.teamId });
      await night(q, other.teamId, player, plus(day, 2));
      const res = await q(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day }]);
    });
  });

  it('defaults the tier to the current season, and answers null when none has started', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const player = await seedPlayer(q, { teamId: team.teamId });
      await night(q, team.teamId, player, '2026-08-20');
      const res = await q('select public.team_season_start($1)::text as day', [team.teamId]);
      expect(res.rows).toEqual([{ day: '2026-08-20' }]);
      const none = await q('select public.team_season_start($1, null)::text as day', [team.teamId]);
      expect(none.rows).toEqual([{ day: null }]);
    });
  });

  it('is callable by anon, the way attendance and seasons are readable', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      const season = tier();
      const day = await seedSeason(q, season);
      const res = await asAnon(...start(team.teamId, season));
      expect(res.rows).toEqual([{ day }]);
    });
  });

  it('refuses a tier the seasons table does not hold', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      await expect(q(...start(team.teamId, 'MID9'))).rejects.toThrow(/is not a season this site knows/i);
    });
  });
});
