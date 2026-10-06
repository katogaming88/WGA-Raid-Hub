// boss_groups, raid_night_bosses, raid_night_lineups and their functions
// (#1216): a standing group per boss, copied into each raid night and edited
// there. The team's raiders read the plan; nobody writes the tables except
// through the functions. raid_night_participation (#1242) is the same shape,
// holding who actually showed up rather than who was planned in.
import { describe, it, expect } from 'vitest';
import {
  withTxn,
  seedPlayer,
  seedKill,
  setTeamDifficulty,
  RAIDER_T1,
  RAIDER_T2,
  OFFICER_T1,
  OFFICER_T2,
  GUILD_OFFICER,
  SITE_ADMIN
} from './helpers.js';

// Four raiders of the test's own (#1123): p1 and p2 on team 1, p3 and p6 on
// team 2. RAIDER_T1's membership (team_members 3) holds p1 and RAIDER_T2's
// (13) holds p6, so each raider reads as a member of their own team; p2 is
// the teammate the cases archive or bench. Minted in that order, so a
// lineup sorted by player id lists p1 before p2.
//
// Two bosses of a raid in the open season (MID2, from 2026-08-11), and a raid
// every day of the week for teams 1 and 2, so any date is a raid night.
async function seed(q) {
  const p1 = await seedPlayer(q, { memberId: 3 });
  const p2 = await seedPlayer(q, { teamId: 1 });
  const p3 = await seedPlayer(q, { teamId: 2 });
  const p6 = await seedPlayer(q, { memberId: 13 });
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9001, 99001, 'Test Raid', 'MID2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (9101, 9001, 99101, 'Second Boss', 2), (9102, 9001, 99102, 'First Boss', 1)`);
  await q(`insert into public.raid_schedule (team_id, weekday, start_time)
           select t, d, '20:00' from generate_series(1, 2) t, generate_series(0, 6) d`);
  return { p1, p2, p3, p6 };
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
      const { p1, p2 } = await seed(q);
      expect((await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2])).rows[0].n).toBe(2);
      expect(await group(q, FIRST)).toEqual([p1, p2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [p2], [p2, p1]);
      expect(await group(q, FIRST)).toEqual([p2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [], [p2]);
      expect(await group(q, FIRST)).toEqual([]);
    });
  });

  it('refuses a save made from a page that is out of date', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      // A second officer still on the empty group they opened earlier.
      await expect(setGroup(asUser, GUILD_OFFICER, FIRST, [p1], [])).rejects.toThrow(/Someone else changed this group/);
      expect(await group(q, FIRST)).toEqual([p1, p2]);
    });
  });

  it('refuses archived raiders, other teams’ raiders, repeats and blanks', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p2 } = await seed(q);
      await q('update public.players set archived_at = now() where id = $1', [p2]);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [p2])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p3 } = await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [p3])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [p1, p1])).rejects.toThrow(/listed twice/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, FIRST, [p1, null])).rejects.toThrow(/list of raiders/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await expect(setGroup(asUser, OFFICER_T1, 424242, [p1])).rejects.toThrow(/not in the raid list/);
    });
  });

  it('lets guild officers and site admins save, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      for (const uid of [GUILD_OFFICER, SITE_ADMIN]) {
        expect((await setGroup(asUser, uid, FIRST, [p1])).rows[0].n).toBe(1);
      }
    });
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        const { p1 } = await seed(q);
        await expect(setGroup(asUser, uid, FIRST, [p1])).rejects.toThrow(/Not authorized/);
      });
    }
  });

  it('writes the whole group into the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p2, p1]);
      const log = await q("select team_id, target_id, detail from public.audit_log where action = 'Set Boss Group'");
      expect(log.rows).toEqual([
        { team_id: 1, target_id: FIRST, detail: { boss: 'First Boss', player_ids: [p2, p1], nights_following: [] } }
      ]);
    });
  });

  it('reaches coming nights nobody has saved, and leaves saved and past nights alone', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      const tomorrow = await today(q, 1);
      const nextWeek = await today(q, 7);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, tomorrow);
      await plan(asUser, OFFICER_T1, nextWeek);
      await plan(asUser, OFFICER_T1, PAST);
      await setNight(asUser, OFFICER_T1, nextWeek, FIRST, [p1], [p1, p2]);

      await setGroup(asUser, OFFICER_T1, FIRST, [p2], [p1, p2]);
      expect((await night(q, tomorrow))[0].players).toEqual([p2]);
      expect((await night(q, nextWeek))[0].players).toEqual([p1]);
      expect((await night(q, PAST))[0].players).toEqual([p1, p2]);
    });
  });
});

describe('plan_raid_night()', () => {
  it('fills a night from the groups in pull order, leaving out archived raiders', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1, p2]);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await q('update public.players set archived_at = now() where id = $1', [p2]);

      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(2);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [p1] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: false, players: [p1] }
      ]);
    });
  });

  it('starts bench raiders out on every boss, even when they are in the group', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await q('update public.players set is_bench = true where id = $1', [p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      expect((await night(q, '2026-09-17'))[0].players).toEqual([p1]);

      // A group edit reaching the night, and a boss put back, leave them out too.
      const tomorrow = await today(q, 1);
      await plan(asUser, OFFICER_T1, tomorrow);
      await setGroup(asUser, OFFICER_T1, FIRST, [p2, p1], [p1, p2]);
      expect((await night(q, tomorrow))[0].players).toEqual([p1]);
      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, true);
      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, false);
      expect((await night(q, '2026-09-17'))[0].players).toEqual([p1]);

      // An officer can still put them in for the night.
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1, p2], [p1]);
      expect((await night(q, '2026-09-17'))[0].players).toEqual([p1, p2]);
    });
  });

  it('leaves a planned night alone', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p2]);
      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(0);
      expect((await night(q, '2026-09-17'))[0].players).toEqual([p2]);
    });
  });

  it('only uses the bosses of the season the night falls in', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
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
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');

      expect((await setNight(asUser, OFFICER_T1, '2026-09-17', SECOND, [p2], [p1, p2])).rows[0].n).toBe(1);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [p1, p2] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: true, players: [p2] }
      ]);
      // The standing group is untouched.
      expect(await group(q, SECOND)).toEqual([p1, p2]);

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
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1], [p1, p2]);
      await expect(setNight(asUser, GUILD_OFFICER, '2026-09-17', FIRST, [p2], [p1, p2])).rejects.toThrow(
        /Someone else changed this boss/
      );
      expect((await night(q, '2026-09-17'))[0].players).toEqual([p1]);
    });
  });

  it('adds a boss that is not on the night yet, after the others', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', SECOND, [p2], []);
      expect((await night(q, '2026-09-17')).map((b) => [b.encounter_id, b.position, b.players])).toEqual([
        [FIRST, 1, [p1]],
        [SECOND, 2, [p2]]
      ]);
    });
  });

  it('refuses archived and other teams’ raiders, and a night the team does not raid', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p2 } = await seed(q);
      await q('update public.players set archived_at = now() where id = $1', [p2]);
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p2])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p3 } = await seed(q);
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p3])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await q('delete from public.raid_schedule where team_id = 1');
      await expect(setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1])).rejects.toThrow(/no raid that night/);
    });
  });

  it('writes the lineup and what it replaced into the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p2]);
      const log = await q("select detail from public.audit_log where action = 'Set Raid Night Lineup'");
      expect(log.rows[0].detail).toMatchObject({ raid_date: '2026-09-17', boss: 'First Boss', player_ids: [p2] });
      expect([...log.rows[0].detail.was].sort((a, b) => a - b)).toEqual([p1, p2]);
    });
  });

  it('refuses raiders and other teams’ officers', async () => {
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        const { p1 } = await seed(q);
        await expect(setNight(asUser, uid, '2026-09-17', FIRST, [p1])).rejects.toThrow(/Not authorized/);
      });
    }
  });
});

describe('set_raid_night_boss_skipped()', () => {
  it('takes a boss off the night and puts it back from its group', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await setNight(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1]);

      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, true);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: true, confirmed: false, players: [] }
      ]);
      // A night with every boss skipped is still planned, so it is not refilled.
      expect((await plan(asUser, OFFICER_T1, '2026-09-17')).rows[0].n).toBe(0);

      await skip(asUser, OFFICER_T1, '2026-09-17', FIRST, false);
      expect(await night(q, '2026-09-17')).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [p1, p2] }
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

const record = (asUser, uid, date, encounter, players, team = 1) =>
  asUser(uid, 'select public.record_raid_night_participation($1, $2, $3, $4::int[]) as n', [
    team,
    date,
    encounter,
    players
  ]);

const participation = async (q, date, encounter, team = 1) =>
  (
    await q(
      'select coalesce(array_agg(player_id order by player_id), $4) as p from public.raid_night_participation where team_id = $1 and raid_date = $2 and encounter_id = $3',
      [team, date, encounter, '{}']
    )
  ).rows[0].p;

describe('record_raid_night_participation()', () => {
  it('records who was in for a boss, and replaces it on the next call', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      expect((await record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1, p2])).rows[0].n).toBe(2);
      expect(await participation(q, '2026-09-17', FIRST)).toEqual([p1, p2]);
      expect((await record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1])).rows[0].n).toBe(1);
      expect(await participation(q, '2026-09-17', FIRST)).toEqual([p1]);
    });
  });

  it('is a no-op, not an error, for a boss that is not on the night', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      expect((await record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1])).rows[0].n).toBe(0);
      expect(await participation(q, '2026-09-17', FIRST)).toEqual([]);
    });
  });

  it('refuses archived raiders and other teams’ raiders', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await q('update public.players set archived_at = now() where id = $1', [p2]);
      await expect(record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p2])).rejects.toThrow(/must be on this team/);
    });
    await withTxn(async ({ q, asUser }) => {
      const { p1, p3 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await expect(record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p3])).rejects.toThrow(/must be on this team/);
    });
  });

  it('lets guild officers and site admins write, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      for (const uid of [GUILD_OFFICER, SITE_ADMIN]) {
        expect((await record(asUser, uid, '2026-09-17', FIRST, [p1])).rows[0].n).toBe(1);
      }
    });
    for (const uid of [RAIDER_T1, OFFICER_T2]) {
      await withTxn(async ({ q, asUser }) => {
        const { p1 } = await seed(q);
        await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
        await plan(asUser, OFFICER_T1, '2026-09-17');
        await expect(record(asUser, uid, '2026-09-17', FIRST, [p1])).rejects.toThrow(/Not authorized/);
      });
    }
  });

  it('is read the same way as the rest of the plan, and refuses direct writes', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      await record(asUser, OFFICER_T1, '2026-09-17', FIRST, [p1]);
      expect((await asUser(RAIDER_T1, 'select team_id from public.raid_night_participation')).rows).toEqual([
        { team_id: 1 }
      ]);
      expect((await asUser(RAIDER_T2, 'select * from public.raid_night_participation')).rows).toEqual([]);
      expect((await asAnon('select * from public.raid_night_participation')).rows).toEqual([]);
      await expect(
        asUser(
          OFFICER_T1,
          'insert into public.raid_night_participation (team_id, raid_date, encounter_id, player_id) values (1, $1, $2, $3)',
          ['2026-09-17', FIRST, p1]
        )
      ).rejects.toThrow(/row-level security|permission denied/);
    });
  });
});

describe('fill_upcoming_raid_nights()', () => {
  it('fills the coming week for teams with a group, and nobody can call it from the site', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
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
    const players = await seed(q);
    await setGroup(asUser, OFFICER_T1, FIRST, [players.p1]);
    await setGroup(asUser, OFFICER_T2, FIRST, [players.p6], null, 2);
    await plan(asUser, OFFICER_T1, '2026-09-17');
    await plan(asUser, OFFICER_T2, '2026-09-17', 2);
    return players;
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
      const { p1 } = await plans(q, asUser);
      await q('update public.players set archived_at = now() where id = $1', [p1]);
      for (const table of TABLES) {
        expect((await asAnon(`select * from public.${table}`)).rows).toHaveLength(0);
        expect(await teams(asUser, RAIDER_T1, table)).toEqual([]);
      }
    });
  });

  it('refuses direct writes, officers included', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await expect(
        asUser(OFFICER_T1, 'insert into public.boss_groups (team_id, encounter_id, player_id) values (1, $1, $2)', [
          FIRST,
          p1
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
      const { p3 } = await seed(q);
      await expect(
        q('insert into public.boss_groups (team_id, encounter_id, player_id) values (1, $1, $2)', [FIRST, p3])
      ).rejects.toThrow(/does not match players.team_id/);
    });
  });
});

// The test's own kills (#1246), of the first boss unless a case names another.
const kill = (q, kill) => seedKill(q, { encounter: FIRST, ...kill });

// A raid date counted from the Tuesday that opens this lockout: day(q, 0) is
// that Tuesday and day(q, 6) the Monday that closes it, which is never before
// today, so every case can plan a coming night there whatever day it runs.
const day = async (q, n) =>
  (await q('select (public.lockout_week_start(public.raid_today()) + $1::int)::text as d', [n])).rows[0].d;

// raid_today() fixed to a date of this lockout, for this transaction only, so
// a case can put nights on both sides of today whatever day the suite runs.
const pinToday = (q, date) =>
  q(`create or replace function public.raid_today() returns date language sql stable
     set search_path = public as $$ select date '${date}' $$`);

// The kill that took a boss off a night, or null.
const reason = async (q, date, encounter, team = 1) =>
  (
    await q(
      'select skipped_for_kill_id as k from public.raid_night_bosses where team_id = $1 and raid_date = $2 and encounter_id = $3',
      [team, date, encounter]
    )
  ).rows[0].k;

const skipLog = async (q) =>
  (
    await q(
      "select team_id, actor_id, target_type, target_id, detail from public.audit_log where action = 'Skip Killed Boss' order by id"
    )
  ).rows;

const skippedOn = async (q, date, team = 1) => (await night(q, date, team)).map((b) => [b.encounter_id, b.skipped]);

describe('a boss killed earlier in the lockout (#1246)', () => {
  // Team 1 raids Mythic unless told otherwise, both bosses have a group, and
  // the Monday that closes this lockout is planned before any kill arrives.
  async function planned(q, asUser, { difficulty = 'mythic' } = {}) {
    const players = await seed(q);
    await setTeamDifficulty(q, difficulty);
    await setGroup(asUser, OFFICER_T1, FIRST, [players.p1, players.p2]);
    await setGroup(asUser, OFFICER_T1, SECOND, [players.p1]);
    const monday = await day(q, 6);
    await plan(asUser, OFFICER_T1, monday);
    return { ...players, monday, tuesday: await day(q, 0) };
  }

  it('takes the boss off a later night that week at the kill’s difficulty, with its lineup, and keeps which kill did it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, monday, tuesday } = await planned(q, asUser);
      const id = await kill(q, { report: 'r1', date: tuesday });
      expect(await night(q, monday)).toEqual([
        { encounter_id: FIRST, position: 1, skipped: true, confirmed: false, players: [] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: false, players: [p1] }
      ]);
      expect(await reason(q, monday, FIRST)).toBe(id);
      expect(await reason(q, monday, SECOND)).toBe(null);
    });
  });

  it('logs each skip with no author, naming the night, the boss and the kill', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { report: 'r1', date: tuesday });
      expect(await skipLog(q)).toEqual([
        {
          team_id: 1,
          actor_id: null,
          target_type: 'raid_night_bosses',
          target_id: FIRST,
          detail: { raid_date: monday, boss: 'First Boss', killed_on: tuesday, difficulty: 'mythic', report_code: 'r1' }
        }
      ]);
    });
  });

  it('counts a night that goes Heroic into Mythic as Mythic, so a Heroic kill leaves its boss on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser, { difficulty: 'heroic_into_mythic' });
      await kill(q, { encounter: FIRST, difficulty: 'mythic', report: 'r1', fight: 1, date: tuesday });
      await kill(q, { encounter: SECOND, difficulty: 'heroic', report: 'r1', fight: 2, date: tuesday });
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, true],
        [SECOND, false]
      ]);
    });
  });

  it('never reaches another team’s night, nor a night with no difficulty', async () => {
    // Team 2 raids Mythic too, and only team 1 killed.
    await withTxn(async ({ q, asUser }) => {
      const { p6, monday, tuesday } = await planned(q, asUser);
      await setTeamDifficulty(q, 'mythic', 2);
      await setGroup(asUser, OFFICER_T2, FIRST, [p6], null, 2);
      await plan(asUser, OFFICER_T2, monday, 2);
      await kill(q, { team: 1, report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect(await skippedOn(q, monday, 2)).toEqual([[FIRST, false]]);
    });
    // Team 2 says no difficulty, and both teams killed.
    await withTxn(async ({ q, asUser }) => {
      const { p6, monday, tuesday } = await planned(q, asUser);
      await setGroup(asUser, OFFICER_T2, FIRST, [p6], null, 2);
      await plan(asUser, OFFICER_T2, monday, 2);
      await kill(q, { team: 1, report: 'r1', date: tuesday });
      await kill(q, { team: 2, report: 'r2', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect(await skippedOn(q, monday, 2)).toEqual([[FIRST, false]]);
    });
    // Another team's kill, stored first, is not one of this team's kills.
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { team: 2, report: 'r2', date: tuesday });
      await kill(q, { team: 1, report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
    });
    // Nor does it take a boss off a night this team plans afterwards.
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await kill(q, { team: 2, report: 'r2', date: await day(q, 0) });
      const monday = await day(q, 6);
      await plan(asUser, OFFICER_T1, monday);
      expect(await skippedOn(q, monday)).toEqual([[FIRST, false]]);
    });
  });

  it('leaves the boss on the night the kill happened', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { encounter: FIRST, report: 'r1', date: monday });
      await kill(q, { encounter: SECOND, report: 'r0', date: tuesday });
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, false],
        [SECOND, true]
      ]);
    });
  });

  it('leaves a boss an officer saved or skipped for the night as they left it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p2, monday, tuesday } = await planned(q, asUser);
      await setNight(asUser, OFFICER_T1, monday, FIRST, [p2]);
      await kill(q, { encounter: FIRST, report: 'r1', fight: 1, date: tuesday });
      await kill(q, { encounter: SECOND, report: 'r1', fight: 2, date: tuesday });
      expect(await night(q, monday)).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: true, players: [p2] },
        { encounter_id: SECOND, position: 2, skipped: true, confirmed: false, players: [] }
      ]);
    });
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await skip(asUser, OFFICER_T1, monday, FIRST, true);
      await kill(q, { encounter: FIRST, report: 'r1', fight: 1, date: tuesday });
      await kill(q, { encounter: SECOND, report: 'r1', fight: 2, date: tuesday });
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, true],
        [SECOND, true]
      ]);
      expect(await reason(q, monday, FIRST)).toBe(null);
      expect((await skipLog(q)).map((r) => r.target_id)).toEqual([SECOND]);
    });
  });

  it('stays inside the kill’s lockout, and never rewrites a night already played', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      const nextTuesday = await day(q, 7);
      const lastMonday = await day(q, -1);
      await plan(asUser, OFFICER_T1, nextTuesday);
      await plan(asUser, OFFICER_T1, lastMonday);
      // Last week's kill, synced late, beside this week's.
      await kill(q, { encounter: FIRST, report: 'r0', date: await day(q, -7) });
      await kill(q, { encounter: FIRST, report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect((await skippedOn(q, nextTuesday))[0]).toEqual([FIRST, false]);
      expect((await skippedOn(q, lastMonday))[0]).toEqual([FIRST, false]);
    });
  });

  it('counts a report from before Tuesday’s reset in the lockout it was played in', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      // Tuesday morning Eastern is before the 15:00 UTC reset.
      await kill(q, { encounter: FIRST, report: 'r0', date: tuesday, started: `${tuesday} 09:00 America/New_York` });
      await kill(q, { encounter: SECOND, report: 'r1', date: tuesday });
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, false],
        [SECOND, true]
      ]);
    });
  });

  // Today is pinned into next week, so tonight's 20:00 start is still ahead of
  // the real clock, or into last week, so it has passed, whatever time the
  // suite runs.
  it('counts tonight until it starts', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      const [wednesday, thursday, friday] = [await day(q, 8), await day(q, 9), await day(q, 10)];
      await pinToday(q, friday);
      await plan(asUser, OFFICER_T1, thursday);
      await plan(asUser, OFFICER_T1, friday);
      await kill(q, { report: 'r1', date: wednesday });
      expect(await skippedOn(q, friday)).toEqual([[FIRST, true]]);
      expect(await skippedOn(q, thursday)).toEqual([[FIRST, false]]);
    });
  });

  it('leaves a night already under way alone, and still reaches the nights after it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      const [wednesday, friday, saturday] = [await day(q, -6), await day(q, -4), await day(q, -3)];
      await pinToday(q, friday);
      await plan(asUser, OFFICER_T1, friday);
      await plan(asUser, OFFICER_T1, saturday);
      await kill(q, { report: 'r1', date: wednesday });
      expect(await night(q, friday)).toEqual([
        { encounter_id: FIRST, position: 1, skipped: false, confirmed: false, players: [p1] }
      ]);
      expect(await skippedOn(q, saturday)).toEqual([[FIRST, true]]);
    });
  });

  it('takes a boss off a night when the first kill before it arrives, even after a later one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await pinToday(q, tuesday);
      const thursday = await day(q, 2);
      await plan(asUser, OFFICER_T1, thursday);
      // Friday's log is uploaded before Tuesday's.
      await kill(q, { report: 'fri', date: await day(q, 3) });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect((await skippedOn(q, thursday))[0]).toEqual([FIRST, false]);
      const id = await kill(q, { report: 'tue', date: tuesday });
      expect((await skippedOn(q, thursday))[0]).toEqual([FIRST, true]);
      expect(await reason(q, thursday, FIRST)).toBe(id);
    });
  });

  it('skips once for two logs of one kill, and a boss put back stays back when another log arrives', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2, monday, tuesday } = await planned(q, asUser);
      // Two raiders logged the same kill; the sync stores both in one insert.
      const both = await q(
        `insert into public.team_raid_kills
           (team_id, encounter_id, difficulty, report_code, fight_id, raid_date, report_started_at)
         values (1, $1, 'mythic', 'late', 4, $2, ($2::date + time '20:30') at time zone 'America/New_York'),
                (1, $1, 'mythic', 'early', 7, $2, ($2::date + time '20:00') at time zone 'America/New_York')
         returning id, report_code`,
        [FIRST, tuesday]
      );
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect(await reason(q, monday, FIRST)).toBe(both.rows.find((r) => r.report_code === 'early').id);
      expect(await skipLog(q)).toHaveLength(1);

      await skip(asUser, OFFICER_T1, monday, FIRST, false);
      expect(await reason(q, monday, FIRST)).toBe(null);
      await kill(q, { report: 'third', date: await day(q, 1) });
      expect((await night(q, monday))[0]).toEqual({
        encounter_id: FIRST,
        position: 1,
        skipped: false,
        confirmed: false,
        players: [p1, p2]
      });
      expect(await skipLog(q)).toHaveLength(1);
    });
  });

  it('puts the boss back when an officer saves its lineup for the night', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p2, monday, tuesday } = await planned(q, asUser);
      await kill(q, { report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      await setNight(asUser, OFFICER_T1, monday, FIRST, [p2], []);
      expect((await night(q, monday))[0]).toEqual({
        encounter_id: FIRST,
        position: 1,
        skipped: false,
        confirmed: true,
        players: [p2]
      });
      expect(await reason(q, monday, FIRST)).toBe(null);
    });
  });

  it('never keeps a kill on a boss that is back on the night', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      await expect(
        q(
          'update public.raid_night_bosses set skipped = false where team_id = 1 and raid_date = $1 and encounter_id = $2',
          [monday, FIRST]
        )
      ).rejects.toThrow(/raid_night_bosses_kill_only_when_skipped/);
    });
  });

  it('plans a night with a boss already killed that lockout, at its difficulty, as skipped and logged', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
      const [tuesday, monday] = [await day(q, 0), await day(q, 6)];
      // Two logs of one kill, the later-starting one stored first.
      await kill(q, { report: 'late', fight: 4, date: tuesday, started: `${tuesday} 20:30 America/New_York` });
      const early = await kill(q, { report: 'early', fight: 7, date: tuesday });
      await kill(q, { encounter: SECOND, difficulty: 'heroic', report: 'early', fight: 8, date: tuesday });
      await plan(asUser, OFFICER_T1, monday);
      expect(await night(q, monday)).toEqual([
        { encounter_id: FIRST, position: 1, skipped: true, confirmed: false, players: [] },
        { encounter_id: SECOND, position: 2, skipped: false, confirmed: false, players: [p1] }
      ]);
      expect(await reason(q, monday, FIRST)).toBe(early);
      expect(await skipLog(q)).toEqual([
        {
          team_id: 1,
          actor_id: null,
          target_type: 'raid_night_bosses',
          target_id: FIRST,
          detail: {
            raid_date: monday,
            boss: 'First Boss',
            killed_on: tuesday,
            difficulty: 'mythic',
            report_code: 'early'
          }
        }
      ]);
    });
  });

  it('plans a boss killed only last lockout, or on the night itself, as usual', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
               values (9103, 9001, 99103, 'Third Boss', 3)`);
      await setTeamDifficulty(q, 'mythic');
      for (const boss of [FIRST, SECOND, 9103]) await setGroup(asUser, OFFICER_T1, boss, [p1]);
      const monday = await day(q, 6);
      await kill(q, { encounter: FIRST, report: 'r0', date: await day(q, -1) });
      await kill(q, { encounter: SECOND, report: 'r1', date: monday });
      await kill(q, { encounter: 9103, report: 'r2', date: await day(q, 0) });
      await plan(asUser, OFFICER_T1, monday);
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, false],
        [SECOND, false],
        [9103, true]
      ]);
    });
  });

  it('takes the team’s lineup lock before it reads, as every lineup write does', async () => {
    await withTxn(async ({ q }) => {
      await seed(q);
      await setTeamDifficulty(q, 'mythic');
      const monday = await day(q, 6);
      // Written directly: planning takes the lock, which then stays held to the
      // end of the transaction and would satisfy the check below by itself.
      await q(
        'insert into public.raid_night_bosses (team_id, raid_date, encounter_id, position) values (1, $1, $2, 1)',
        [monday, FIRST]
      );
      const held = async (team) =>
        (
          await q(
            `select count(*)::int as n from pg_locks
              where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2
                and classid::bigint = (hashtext('boss_lineup')::bigint + 4294967296) % 4294967296
                and objid::bigint = $1`,
            [team]
          )
        ).rows[0].n;
      expect(await held(1)).toBe(0);
      // The rule the skip reads, wrapped to refuse a read made without the lock.
      await q(
        'alter function public.kills_before_night(integer, integer, date, text) rename to kills_before_night_unwrapped'
      );
      await q(`create function public.kills_before_night(
                 p_team_id integer, p_encounter_id integer, p_raid_date date, p_difficulty text)
               returns setof public.team_raid_kills language plpgsql stable set search_path = public
               as $$ begin
                 if not exists (select 1 from pg_locks
                                 where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2
                                   and classid::bigint = (hashtext('boss_lineup')::bigint + 4294967296) % 4294967296
                                   and objid::bigint = p_team_id) then
                   raise exception 'read before the lock';
                 end if;
                 return query select * from public.kills_before_night_unwrapped(p_team_id, p_encounter_id, p_raid_date, p_difficulty);
               end $$`);
      await kill(q, { report: 'r1', date: await day(q, 0) });
      expect(await skippedOn(q, monday)).toEqual([[FIRST, true]]);
      expect(await held(1)).toBe(1);
      expect(await held(2)).toBe(0);
    });
  });

  it('fails the kill’s insert when the skip fails, so the sync’s next run sends it again and skips', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      // A rule the skip reads that always fails, until the savepoint is rolled back.
      await q('savepoint broken_skip');
      await q(`create or replace function public.kills_before_night(
                 p_team_id integer, p_encounter_id integer, p_raid_date date, p_difficulty text)
               returns setof public.team_raid_kills language plpgsql stable set search_path = public
               as $$ begin raise exception 'broken on purpose'; end $$`);
      await expect(kill(q, { report: 'r1', date: tuesday })).rejects.toThrow(/broken on purpose/);
      await q('rollback to savepoint broken_skip');
      expect(
        (await q("select count(*)::int as n from public.team_raid_kills where report_code = 'r1'")).rows[0].n
      ).toBe(0);
      await kill(q, { report: 'r1', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
    });
  });

  it('cannot be run from the site', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, 'select public.skip_killed_bosses()')).rejects.toThrow(/permission denied/);
    });
  });
});
