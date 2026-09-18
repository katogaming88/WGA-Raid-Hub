// boss_groups, raid_night_bosses, raid_night_lineups and their functions
// (#1216): a standing group per boss, copied into each raid night and edited
// there. The team's raiders read the plan; nobody writes the tables except
// through the functions.
import { describe, it, expect } from 'vitest';
import { withTxn, RAIDER_T1, RAIDER_T2, OFFICER_T1, OFFICER_T2, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

// Players 1 and 2 are on team 1; players 3 and 6 are on team 2. RAIDER_T1's
// membership (team_members 3) holds player 1 and RAIDER_T2's (13) holds
// player 6, so each raider reads as a member of their own team.
//
// Two bosses of a raid in the open season (MID2, from 2026-08-11), and a raid
// every day of the week for teams 1 and 2, so any date is a raid night.
async function seed(q) {
  await q('update public.players set team_member_id = 3 where id = 1');
  await q('update public.players set team_member_id = 13 where id = 6');
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9001, 99001, 'Test Raid', 'Midnight Season 2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (9101, 9001, 99101, 'Second Boss', 2), (9102, 9001, 99102, 'First Boss', 1)`);
  await q(`insert into public.raid_schedule (team_id, weekday, start_time)
           select t, d, '20:00' from generate_series(1, 2) t, generate_series(0, 6) d`);
}

const FIRST = 9102;
const SECOND = 9101;
const PAST = '2026-09-10';

const today = async (q, plus = 0) => (await q('select (public.raid_today() + $1::int)::text as d', [plus])).rows[0].d;

const setGroup = (asUser, uid, encounter, players, expected = null, team = 1) =>
  asUser(uid, 'select public.set_boss_group($1, $2, $3::int[], $4::int[]) as n', [team, encounter, players, expected]);

const plan = (asUser, uid, date, team = 1) => asUser(uid, 'select public.plan_raid_night($1, $2) as n', [team, date]);

const setNight = (asUser, uid, date, encounter, players, expected = null, team = 1) =>
  asUser(uid, 'select public.set_raid_night_lineup($1, $2, $3, $4::int[], $5::int[]) as n', [
    team,
    date,
    encounter,
    players,
    expected
  ]);

const skip = (asUser, uid, date, encounter, skipped) =>
  asUser(uid, 'select public.set_raid_night_boss_skipped(1, $1, $2, $3)', [date, encounter, skipped]);

// Each boss on a night, in order, with its lineup as sorted player ids.
const night = async (q, date, team = 1) =>
  (
    await q(
      `select b.encounter_id, b.position, b.skipped, b.confirmed_at is not null as confirmed,
              coalesce((select array_agg(l.player_id order by l.player_id) from public.raid_night_lineups l
                        where l.team_id = b.team_id and l.raid_date = b.raid_date and l.encounter_id = b.encounter_id), '{}') as players
         from public.raid_night_bosses b
        where b.team_id = $1 and b.raid_date = $2
        order by b.position`,
      [team, date]
    )
  ).rows;

const group = async (q, encounter, team = 1) =>
  (
    await q(
      'select coalesce(array_agg(player_id order by player_id), $3) as p from public.boss_groups where team_id = $1 and encounter_id = $2',
      [team, encounter, '{}']
    )
  ).rows[0].p;

describe('set_boss_group()', () => {
  it('saves a standing group and replaces it on the next save', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      expect((await setGroup(asUser, OFFICER_T1, FIRST, [1, 2])).rows[0].n).toBe(2);
      expect(await group(q, FIRST)).toEqual([1, 2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [2], [2, 1]);
      expect(await group(q, FIRST)).toEqual([2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [], [2]);
      expect(await group(q, FIRST)).toEqual([]);
    });
  });

  it('refuses a save made from a page that is out of date', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      // A second officer still on the empty group they opened earlier.
      await expect(setGroup(asUser, GUILD_OFFICER, FIRST, [1], [])).rejects.toThrow(/Someone else changed this group/);
      expect(await group(q, FIRST)).toEqual([1, 2]);
    });
  });

  it('refuses archived raiders, other teams’ raiders, repeats and blanks', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await q('update public.players set archived_at = now() where id = 2');
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [2])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [3])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [1, 1])).rejects.toThrow(/listed twice/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [1, null])).rejects.toThrow(/list of raiders/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, 424242, [1])).rejects.toThrow(/not in the raid list/);
    });
  });

  it('lets guild officers and site admins save, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      for (const uid of [GUILD_OFFICER, SITE_ADMIN]) {
        expect((await setGroup(asUser, uid, FIRST, [1])).rows[0].n).toBe(1);
      }
    });
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        await seed(q);
        await expect(setGroup(asUser, uid, FIRST, [1])).rejects.toThrow(/Not authorized/);
      });
    }
  });

  it('writes the whole group into the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [2, 1]);
      const log = await q("select team_id, target_id, detail from public.audit_log where action = 'Set Boss Group'");
      expect(log.rows).toEqual([
        { team_id: 1, target_id: FIRST, detail: { boss: 'First Boss', player_ids: [2, 1], nights_following: [] } }
      ]);
    });
  });

  it('reaches coming nights nobody has saved, and leaves saved and past nights alone', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      const tomorrow = await today(q, 1);
      const nextWeek = await today(q, 7);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await plan(asUser, OFFICER_T1, tomorrow);
      await plan(asUser, OFFICER_T1, nextWeek);
      await plan(asUser, OFFICER_T1, PAST);
      await setNight(asUser, OFFICER_T1, nextWeek, FIRST, [1], [1, 2]);

      await setGroup(asUser, OFFICER_T1, FIRST, [2], [1, 2]);
      expect((await night(q, tomorrow))[0].players).toEqual([2]);
      expect((await night(q, nextWeek))[0].players).toEqual([1]);
      expect((await night(q, PAST))[0].players).toEqual([1, 2]);
    });
  });
});

describe('plan_raid_night()', () => {
  it('fills a night from the groups in pull order, leaving out archived raiders', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, SECOND, [1, 2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [1]);
      await q('update public.players set archived_at = now() where id = 2');

      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(2);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [1] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: false, players: [1] }
      ]);
    });
  });

  it('leaves a planned night alone', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [2]);
      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(0);
      expect((await night(q, '2026-09-17'))[0].players).toEqual([2]);
    });
  });

  it('only uses the bosses of the season the night falls in', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1]);
      // A night in the seed season, before MID2 began.
      expect((await plan(asUser, OFFICER_T1, '2026-01-15')).rows[0].n).toBe(0);
    });
  });

  it('refuses a night the team does not raid', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await q(
        "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type) values (1, '2026-09-17', 'cancelled')"
      );
      await expect(plan(asUser, OFFICER_T1, '2026-09-17')).rejects.toThrow(/no raid that night/);
    });
  });

  it('refuses raiders', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(plan(asUser, RAIDER_T1, '2026-09-17')).rejects.toThrow(/Not authorized/);
    });
  });
});

describe('set_raid_night_lineup()', () => {
  it('saves one boss for one night and marks it confirmed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await setGroup(asUser, OFFICER_T1, SECOND, [1, 2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');

      expect((await setNight(asUser, OFFICER_T1, '2026-09-17', SECOND, [2], [1, 2])).rows[0].n).toBe(1);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [1, 2] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: true, players: [2] }
      ]);
      // The standing group is untouched.
      expect(await group(q, SECOND)).toEqual([1, 2]);

      const who = await q(
        `select b.confirmed_by = (select person_id from public.team_members where auth_user_id = $1) as me
           from public.raid_night_bosses b where b.encounter_id = $2`,
        [OFFICER_T1, SECOND]
      );
      expect(who.rows[0].me).toBe(true);
    });
  });

  it('refuses a save made after someone else changed that boss', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [1], [1, 2]);
      await expect(setNight(asUser, GUILD_OFFICER, '2026-09-17', FIRST, [2], [1, 2])).rejects.toThrow(
        /Someone else changed this boss/
      );
      expect((await night(q, '2026-09-17'))[0].players).toEqual([1]);
    });
  });

  it('adds a boss that is not on the night yet, after the others', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', SECOND, [2], []);
      expect((await night(q, '2026-09-17')).map((b) => [b.encounter_id, b.position, b.players])).toEqual([
        [FIRST, 1, [1]],
        [SECOND, 2, [2]]
      ]);
    });
  });

  it('refuses archived and other teams’ raiders, and a night the team does not raid', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await q('update public.players set archived_at = now() where id = 2');
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [2])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [3])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await q('delete from public.raid_schedule where team_id = 1');
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [1])).rejects.toThrow(/no raid that night/);
    });
  });

  it('writes the lineup and what it replaced into the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [2]);
      const log = await q("select detail from public.audit_log where action = 'Set Raid Night Lineup'");
      expect(log.rows[0].detail).toMatchObject({ raid_date: '2026-09-17', boss: 'First Boss', player_ids: [2] });
      expect([...log.rows[0].detail.was].sort()).toEqual([1, 2]);
    });
  });

  it('refuses raiders and other teams’ officers', async () => {
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        await seed(q);
        await expect(setNight(asUser, uid, '2026-09-17', FIRST, [1])).rejects.toThrow(/Not authorized/);
      });
    }
  });
});

describe('set_raid_night_boss_skipped()', () => {
  it('takes a boss off the night and puts it back from its group', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1, 2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [1]);

      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, true);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: true, confirmed: false, players: [] }
      ]);
      // A night with every boss skipped is still planned, so it is not refilled.
      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(0);

      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, false);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [1, 2] }
      ]);
    });
  });

  it('refuses a boss that is not on the night', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(skip(asUser, OFFICER_T1, '2026-09-17', FIRST, true)).rejects.toThrow(/not on this night/);
    });
  });
});

describe('fill_upcoming_raid_nights()', () => {
  it('fills the coming week for teams with a group, and nobody can call it from the site', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [1]);
      const filled = await q('select public.fill_upcoming_raid_nights() as n');
      expect(filled.rows[0].n).toBe(7);
      expect((await q('select count(*)::int as n from public.raid_night_bosses where team_id = 2')).rows[0].n).toBe(0);
      // Running again changes nothing.
      expect((await q('select public.fill_upcoming_raid_nights() as n')).rows[0].n).toBe(0);
      await expect(asUser(SITE_ADMIN, 'select public.fill_upcoming_raid_nights()')).rejects.toThrow(
        /permission denied/
      );
      await expect(asUser(SITE_ADMIN, "select public.fill_raid_night(1, '2026-09-17')")).rejects.toThrow(
        /permission denied/
      );
    });
  });

  it('is scheduled hourly', async () => {
    await withTxn(async ({ q }) => {
      const job = await q("select schedule, command from cron.job where jobname = 'fill-raid-night-lineups'");
      expect(job.rows).toEqual([{ schedule: '5 * * * *', command: ' select public.fill_upcoming_raid_nights(); ' }]);
    });
  });
});

describe('lineup reads', () => {
  const TABLES = ['boss_groups', 'raid_night_bosses', 'raid_night_lineups'];

  // A team 1 plan and a team 2 plan, one row in each table for each team.
  async function plans(q, asUser) {
    await seed(q);
    await setGroup(asUser, OFFICER_T1, FIRST, [1]);
    await setGroup(asUser, OFFICER_T2, FIRST, [6], null, 2);
    await plan(asUser, OFFICER_T1, '2026-09-17');
    await plan(asUser, OFFICER_T2, '2026-09-17', 2);
  }

  const teams = async (asUser, uid, table) =>
    (await asUser(uid, `select distinct team_id from public.${table} order by team_id`)).rows.map((r) => r.team_id);

  it('shows each team’s plan to its own raiders and officers only', async () => {
    await withTxn(async ({ q, asUser }) => {
      await plans(q, asUser);
      for (const table of TABLES) {
        expect(await teams(asUser, RAIDER_T1, table)).toEqual([1]);
        expect(await teams(asUser, OFFICER_T1, table)).toEqual([1]);
        expect(await teams(asUser, RAIDER_T2, table)).toEqual([2]);
        expect(await teams(asUser, OFFICER_T2, table)).toEqual([2]);
        expect(await teams(asUser, GUILD_OFFICER, table)).toEqual([1, 2]);
        expect(await teams(asUser, SITE_ADMIN, table)).toEqual([1, 2]);
      }
    });
  });

  it('hides the plan from a raider who has left the team, and from signed-out visitors', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await plans(q, asUser);
      await q('update public.players set archived_at = now() where id = 1');
      for (const table of TABLES) {
        expect((await asAnon(`select * from public.${table}`)).rows).toHaveLength(0);
        expect(await teams(asUser, RAIDER_T1, table)).toEqual([]);
      }
    });
  });

  it('refuses direct writes, officers included', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(
        asUser(OFFICER_T1, 'insert into public.boss_groups (team_id, encounter_id, player_id) values (1, $1, 1)', [
          FIRST
        ])
      ).rejects.toThrow(/row-level security|permission denied/);
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.raid_night_bosses (team_id, raid_date, encounter_id, position) values (1, '2026-09-17', $1, 1)",
          [FIRST]
        )
      ).rejects.toThrow(/row-level security|permission denied/);
    });
  });

  it('stops a raider being filed under another team, even by a direct write', async () => {
    await withTxn(async ({ q }) => {
      await seed(q);
      await expect(
        q('insert into public.boss_groups (team_id, encounter_id, player_id) values (1, $1, 3)', [FIRST])
      ).rejects.toThrow(/does not match players.team_id/);
    });
  });
});
