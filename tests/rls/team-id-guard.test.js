// #944: every table that carries team_id beside player_id runs
// check_team_id_matches_player() before a write, so a row filed under the
// wrong team is refused where it is written rather than found later.
// scoring and player_equipped_gear gain the column (backfilled from players,
// not null), and the three two-key tables that had no trigger get one. The
// count is the issue's own acceptance query; the wrong-team cases mint their
// player on team 1 and write team 2, each in its own transaction because an
// expected raise on the transaction's own connection ends it.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

// The issue's query found the guard by its text, a trigger function naming
// both columns. #936's wishlist gate on item_preferences names both as well,
// so this keys on the guard function itself.
const GUARDED_SQL = `
  select c.relname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and not t.tgisinternal
    and p.proname = 'check_team_id_matches_player'
  order by 1`;

// One insert per table, the player as $1 and the team as $2. Every other
// column is the least a row needs.
const INSERTS = {
  scoring: "insert into public.scoring (player_id, team_id, season) values ($1, $2, 'seed-season')",
  player_equipped_gear:
    "insert into public.player_equipped_gear (player_id, team_id, equipment_slot) values ($1, $2, 'HEAD')",
  player_wcl_season_perf:
    "insert into public.player_wcl_season_perf (player_id, team_id, season) values ($1, $2, 'seed-season')",
  raid_rsvps:
    "insert into public.raid_rsvps (team_id, player_id, raid_date, status) values ($2, $1, '2026-09-10', 'Absent')",
  raid_rsvp_reminders_sent:
    "insert into public.raid_rsvp_reminders_sent (team_id, player_id, raid_date, checkpoint) values ($2, $1, '2026-09-10', '24h')"
};

describe('team_id beside player_id is guarded on every table that carries both (#944)', () => {
  it('twenty tables run check_team_id_matches_player() before a write', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(GUARDED_SQL);
      const tables = rows.map((r) => r.relname);
      expect(tables).toHaveLength(20);
      for (const table of Object.keys(INSERTS)) expect(tables).toContain(table);
    });
  });

  it.each(['scoring', 'player_equipped_gear'])('%s carries team_id, not null, keyed to teams', async (table) => {
    await withTxn(async ({ q }) => {
      const col = await q(
        `select data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = 'team_id'`,
        [table]
      );
      expect(col.rows).toEqual([{ data_type: 'integer', is_nullable: 'NO' }]);
      const fk = await q(
        `select count(*)::int as n from pg_constraint
         where conrelid = ('public.' || $1)::regclass and contype = 'f' and confrelid = 'public.teams'::regclass`,
        [table]
      );
      expect(fk.rows[0].n).toBe(1);
    });
  });

  it.each(Object.keys(INSERTS))('%s refuses a row filed under another team than its player', async (table) => {
    await withTxn(async ({ q }) => {
      const pid = await seedPlayer(q, { teamId: 1 });
      await expect(q(INSERTS[table], [pid, 2])).rejects.toThrow(/does not match players.team_id/);
    });
  });

  it('accepts a row on the same team as its player, on all five', async () => {
    await withTxn(async ({ q }) => {
      const pid = await seedPlayer(q, { teamId: 1 });
      for (const table of Object.keys(INSERTS)) await q(INSERTS[table], [pid, 1]);
      const seen = await q(
        `select
           (select count(*) from public.scoring where player_id = $1)
         + (select count(*) from public.player_equipped_gear where player_id = $1)
         + (select count(*) from public.player_wcl_season_perf where player_id = $1)
         + (select count(*) from public.raid_rsvps where player_id = $1)
         + (select count(*) from public.raid_rsvp_reminders_sent where player_id = $1) as n`,
        [pid]
      );
      expect(Number(seen.rows[0].n)).toBe(5);
    });
  });
});
