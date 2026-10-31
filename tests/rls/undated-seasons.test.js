// #1717: a season on file before Blizzard dates it. Each case adds its own
// undated season inside its transaction (Midnight Season 3 itself goes in with
// #1714). An undated season is never the current season, and never closes by
// itself or by close_season. Dating one is in seasons.test.js; taking signups
// for one and closing them early are in declare-season-signup.test.js and
// signup-promotion.test.js.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedSeason, seedPlayer, TEAM_LEADER_T1, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

async function undated(q) {
  const code = `U${randomUUID().slice(0, 7)}`;
  await q('insert into public.seasons (code, display_name) values ($1, $2)', [code, `Undated ${code}`]);
  return code;
}

describe('undated seasons', () => {
  it('comes after every dated season, and MID2 stays current', async () => {
    await withTxn(async ({ q }) => {
      const code = await undated(q);
      const rows = (await q('select code from public.seasons order by starts_at nulls last, position')).rows;
      expect(rows.at(-1).code).toBe(code);
      expect((await q('select public.current_season() as c')).rows[0].c).toBe('MID2');
    });
  });

  it('cannot have an end', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.seasons (code, display_name, ends_at) values ('Uend', 'Uend', '2099-01-01')")
      ).rejects.toThrow(/seasons_window_check/);
    });
  });

  it("two sit side by side, as an expansion's do, and dated seasons still cannot overlap", async () => {
    await withTxn(async ({ q }) => {
      await undated(q);
      await undated(q);
      // A day of this transaction's own, so the overlap is with nothing
      // another test file holds.
      const day = await seedSeason(q, 'Uday');
      await expect(
        q("insert into public.seasons (code, display_name, starts_at, ends_at) values ('Ulap', 'Ulap', $1, $1)", [day])
      ).rejects.toThrow(/seasons_no_overlap/);
    });
  });

  it('close_season refuses it, and it has no start of its own', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await undated(q);
      await expect(asUser(TEAM_LEADER_T1, "select public.close_season(1, $1, '[]'::jsonb)", [code])).rejects.toThrow(
        /has not ended/
      );
      expect((await q('select public.team_season_start(1, $1) as d', [code])).rows[0].d).toBeNull();
    });
  });

  it('signups open for it are not closed by themselves', async () => {
    await withTxn(async ({ q }) => {
      const code = await undated(q);
      const team = await seedTeam(q);
      await q('insert into public.team_seasons (team_id, season_code, signups_open) values ($1, $2, true)', [
        team.teamId,
        code
      ]);
      await q('select public.close_started_season_signups()');
      const { rows } = await q('select signups_open from public.team_seasons where team_id = $1 and season_code = $2', [
        team.teamId,
        code
      ]);
      expect(rows[0].signups_open).toBe(true);
    });
  });

  it("its open wishlist counts in the wishlist nudge, after the live season's, undated ones in order", async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await undated(q);
      const later = await undated(q);
      // Opened in the other order, so only position puts them right.
      await q(
        "insert into public.team_seasons (team_id, season_code, wishlist_open) values (1, $2, true), (1, 'MID2', true), (1, $1, true)",
        [code, later]
      );
      const player = await seedPlayer(q, { teamId: 1, memberId: 3 });
      const rows = (await asUser(OFFICER_T1, 'select * from public.wishlist_setup_status(1)')).rows.filter(
        (r) => r.player_id === player
      );
      expect(rows.map((r) => r.season)).toEqual(['MID2', code, later]);
    });
  });
});
