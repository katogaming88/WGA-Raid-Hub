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
  TEAM_LEADER_T1,
  GUILD_OFFICER,
  SITE_ADMIN,
  seedMember
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
      await expect(setGroup(asUser, TEAM_LEADER_T1, FIRST, [p1], [])).rejects.toThrow(
        /Someone else changed this group/
      );
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

  it('lets site admins save, and nobody else (#1647: not a guild officer)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      expect((await setGroup(asUser, SITE_ADMIN, FIRST, [p1])).rows[0].n).toBe(1);
    });
    for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
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
        {
          team_id: 1,
          target_id: FIRST,
          detail: { boss: 'First Boss', plan: 'mythic', player_ids: [p2, p1], picks: [], nights_following: [] }
        }
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
      await expect(setNight(asUser, TEAM_LEADER_T1, '2026-09-17', FIRST, [p2], [p1, p2])).rejects.toThrow(
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

// #1679: officers set the order the team pulls its bosses in.
describe('set_raid_night_boss_order()', () => {
  const order = (asUser, uid, date, ids, expected, everyNight = false, team = 1) =>
    asUser(uid, 'select public.set_raid_night_boss_order($1, $2, $3::int[], $4::int[], $5)', [
      team,
      date,
      ids,
      expected,
      everyNight
    ]);
  const ids = async (q, date) => (await night(q, date)).map((b) => b.encounter_id);

  // Two nights filled in the game's order (FIRST, then SECOND).
  async function twoNights(q, asUser) {
    const { p1 } = await seed(q);
    await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
    await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
    const [tue, thu] = [await today(q, 1), await today(q, 3)];
    await plan(asUser, OFFICER_T1, tue);
    await plan(asUser, OFFICER_T1, thu);
    return { tue, thu };
  }

  it('reorders one night, leaving the others and later fills as they were', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { tue, thu } = await twoNights(q, asUser);
      await order(asUser, OFFICER_T1, tue, [SECOND, FIRST], [FIRST, SECOND]);
      expect(await night(q, tue)).toMatchObject([
        { encounter_id: SECOND, position: 1 },
        { encounter_id: FIRST, position: 2 }
      ]);
      expect(await ids(q, thu)).toEqual([FIRST, SECOND]);
      const later = await today(q, 5);
      await plan(asUser, OFFICER_T1, later);
      expect(await ids(q, later)).toEqual([FIRST, SECOND]);
    });
  });

  it('with every night after, reorders every coming night, one set by hand too, and later fills follow', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { tue, thu } = await twoNights(q, asUser);
      // Thursday's order set by hand for Thursday alone, then changed back by
      // Tuesday's "every night after" (Kat, 2026-11-18).
      await order(asUser, OFFICER_T1, thu, [SECOND, FIRST], [FIRST, SECOND]);
      await order(asUser, OFFICER_T1, thu, [FIRST, SECOND], [SECOND, FIRST]);
      await order(asUser, OFFICER_T1, tue, [SECOND, FIRST], [FIRST, SECOND], true);
      expect(await ids(q, tue)).toEqual([SECOND, FIRST]);
      expect(await ids(q, thu)).toEqual([SECOND, FIRST]);
      const later = await today(q, 5);
      await plan(asUser, OFFICER_T1, later);
      expect(await ids(q, later)).toEqual([SECOND, FIRST]);
      // A night already past keeps its order.
      await plan(asUser, OFFICER_T1, PAST);
      await order(asUser, OFFICER_T1, tue, [FIRST, SECOND], [SECOND, FIRST], true);
      expect(await ids(q, PAST)).toEqual([SECOND, FIRST]);
    });
  });

  it('puts a boss saved before but missing from a later save after the ones it lists (CodeRabbit on PR #1880)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { tue, thu } = await twoNights(q, asUser);
      await order(asUser, OFFICER_T1, tue, [FIRST, SECOND], [FIRST, SECOND], true);
      // Thursday loses FIRST, then saves SECOND alone for every night after.
      await q('delete from public.raid_night_bosses where team_id = 1 and raid_date = $1 and encounter_id = $2', [
        thu,
        FIRST
      ]);
      await order(asUser, OFFICER_T1, thu, [SECOND], [SECOND], true);
      const { rows } = await q(
        'select encounter_id, position from public.team_boss_order where team_id = 1 order by position'
      );
      expect(rows).toEqual([
        { encounter_id: SECOND, position: 1 },
        { encounter_id: FIRST, position: 2 }
      ]);
      const later = await today(q, 5);
      await plan(asUser, OFFICER_T1, later);
      expect(await ids(q, later)).toEqual([SECOND, FIRST]);
    });
  });

  it('refuses a stale order and one that leaves out or repeats a boss', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { tue } = await twoNights(q, asUser);
      await expect(order(asUser, OFFICER_T1, tue, [SECOND, FIRST], [SECOND, FIRST])).rejects.toThrow(
        /Someone else changed/
      );
      await expect(order(asUser, OFFICER_T1, tue, [SECOND], [FIRST, SECOND])).rejects.toThrow(/every boss/);
      await expect(order(asUser, OFFICER_T1, tue, [SECOND, SECOND], [FIRST, SECOND])).rejects.toThrow(/every boss/);
      expect(await ids(q, tue)).toEqual([FIRST, SECOND]);
    });
  });

  it('lets a team leader and a site admin reorder, and refuses no expected order and a night with no bosses', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { tue } = await twoNights(q, asUser);
      await order(asUser, TEAM_LEADER_T1, tue, [SECOND, FIRST], [FIRST, SECOND]);
      await order(asUser, SITE_ADMIN, tue, [FIRST, SECOND], [SECOND, FIRST]);
      expect(await ids(q, tue)).toEqual([FIRST, SECOND]);
      await expect(order(asUser, OFFICER_T1, tue, [SECOND, FIRST], null)).rejects.toThrow(/Someone else changed/);
      // A raid night nothing has planned yet.
      const empty = await today(q, 2);
      await expect(order(asUser, OFFICER_T1, empty, [], [], true)).rejects.toThrow(/no bosses planned/);
      expect((await q('select count(*)::int as n from public.team_boss_order where team_id = 1')).rows[0].n).toBe(0);
    });
  });

  it("is refused to a raider, another team's officer, a guild officer and a signed-out caller", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { tue } = await twoNights(q, asUser);
      for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
        await expect(order(asUser, uid, tue, [SECOND, FIRST], [FIRST, SECOND], true)).rejects.toThrow(/Not authorized/);
      }
      await expect(
        asAnon('select public.set_raid_night_boss_order(1, $1, $2::int[], $3::int[], true)', [
          tue,
          [SECOND, FIRST],
          [FIRST, SECOND]
        ])
      ).rejects.toThrow(/permission denied/);
      expect(await ids(q, tue)).toEqual([FIRST, SECOND]);
      // Nobody on the site reads the team order directly.
      await expect(asUser(OFFICER_T1, 'select * from public.team_boss_order')).rejects.toThrow(/permission denied/);
    });
  });
});

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

  it('lets site admins write, and nobody else (#1647: not a guild officer)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      expect((await record(asUser, SITE_ADMIN, '2026-09-17', FIRST, [p1])).rows[0].n).toBe(1);
    });
    for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
      await withTxn(async ({ q, asUser }) => {
        const { p1 } = await seed(q);
        await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
        await plan(asUser, OFFICER_T1, '2026-09-17');
        await expect(record(asUser, uid, '2026-09-17', FIRST, [p1])).rejects.toThrow(/Not authorized/);
      });
    }
  });

  // #1845: the hourly attendance run is the service role, with no session.
  it('lets the hourly run (service role) write, still checking the raiders', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      const { p1, p3 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await plan(asUser, OFFICER_T1, '2026-09-17');
      const service = asRole('service_role', null);
      const call = (players) =>
        service('select public.record_raid_night_participation(1, $1, $2, $3::int[]) as n', [
          '2026-09-17',
          FIRST,
          players
        ]);
      expect((await call([p1])).rows[0].n).toBe(1);
      expect(await participation(q, '2026-09-17', FIRST)).toEqual([p1]);
      await expect(call([p3])).rejects.toThrow(/must be on this team/);
    });
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

  // A season with no date yet (#1717) matches no raid night, so its bosses
  // stay off tonight's lineup even with a standing group.
  it("leaves an undated season's bosses off every night", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await q("insert into public.seasons (code, display_name) values ('undated-lineup', 'Undated Lineup')");
      await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
               values (9002, 99002, 'Next Raid', 'undated-lineup', 0)`);
      await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
               values (9103, 9002, 99103, 'Next Boss', 1)`);
      await q('insert into public.boss_groups (team_id, encounter_id, player_id) values (1, 9103, $1)', [p1]);
      await q('select public.fill_upcoming_raid_nights()');
      const bosses = await q('select distinct encounter_id from public.raid_night_bosses where team_id = 1');
      expect(bosses.rows.map((r) => r.encounter_id)).toEqual([FIRST]);
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
  // Today is the lockout's Tuesday, so that Monday is still to come: on a
  // real Monday evening it is tonight and already started, and nothing
  // would be skipped from it (#1793's CI).
  async function planned(q, asUser, { difficulty = 'mythic' } = {}) {
    const players = await seed(q);
    await setTeamDifficulty(q, difficulty);
    await setGroup(asUser, OFFICER_T1, FIRST, [players.p1, players.p2]);
    await setGroup(asUser, OFFICER_T1, SECOND, [players.p1]);
    const tuesday = await day(q, 0);
    await pinToday(q, tuesday);
    const monday = await day(q, 6);
    await plan(asUser, OFFICER_T1, monday);
    return { ...players, monday, tuesday };
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

  it('counts a night with no start time as under way', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      const [wednesday, friday, saturday] = [await day(q, 8), await day(q, 10), await day(q, 11)];
      // An added night with no start time stands in for the weekly 20:00 one.
      await q(
        "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type) values (1, $1, 'added')",
        [friday]
      );
      await pinToday(q, friday);
      await plan(asUser, OFFICER_T1, friday);
      await plan(asUser, OFFICER_T1, saturday);
      await kill(q, { report: 'r1', date: wednesday });
      expect(await skippedOn(q, friday)).toEqual([[FIRST, false]]);
      expect(await skippedOn(q, saturday)).toEqual([[FIRST, true]]);
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

  // #1471: only the team's own raids count, by team_raid_reports.effective_kind.
  it('takes nothing off for an alt run’s kill, nor for a main report an officer calls an alt run', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { report: 'alts', date: tuesday, kind: 'alt' });
      await q(
        `insert into public.team_raid_reports (team_id, report_code, started_at, raid_date, kind, kind_override, kind_override_at)
         values (1, 'overruled', now(), $1, 'main', 'alt', now())`,
        [tuesday]
      );
      await kill(q, { encounter: SECOND, report: 'overruled', fight: 2, date: tuesday });
      expect(await skippedOn(q, monday)).toEqual([
        [FIRST, false],
        [SECOND, false]
      ]);
      expect(await skipLog(q)).toEqual([]);
    });
  });

  it('takes the boss off for the team’s first real kill after an alt run’s kill of it is stored', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { monday, tuesday } = await planned(q, asUser);
      await kill(q, { report: 'alts', date: tuesday, kind: 'alt', started: `${tuesday} 19:00 America/New_York` });
      const id = await kill(q, { report: 'main', date: tuesday });
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
      expect(await reason(q, monday, FIRST)).toBe(id);
    });
  });

  it('plans a night with a boss killed that lockout only by an alt run as usual', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      const [tuesday, monday] = [await day(q, 0), await day(q, 6)];
      await kill(q, { report: 'alts', date: tuesday, kind: 'alt' });
      await plan(asUser, OFFICER_T1, monday);
      expect((await skippedOn(q, monday))[0]).toEqual([FIRST, false]);
    });
  });

  it('skips once for two logs of one kill, and a boss put back stays back when another log arrives', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2, monday, tuesday } = await planned(q, asUser);
      // Two raiders logged the same kill; the sync stores both in one insert,
      // after both reports' rows.
      await q(
        `insert into public.team_raid_reports (team_id, report_code, started_at, raid_date, kind)
         select 1, code, now(), $1, 'main' from unnest(array['late', 'early']) code`,
        [tuesday]
      );
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
      // Today is the lockout's Tuesday, as in planned().
      await pinToday(q, await day(q, 0));
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
      await expect(asUser(SITE_ADMIN, "select public.skip_bosses_for_kills('{1}')")).rejects.toThrow(
        /permission denied/
      );
    });
  });

  // #1472: an officer marks a report as the team's raid or an alt run.
  describe('set_report_kind()', () => {
    const setKind = (asUser, uid, report, kind, team = 1) =>
      asUser(uid, 'select public.set_report_kind($1, $2, $3)', [team, report, kind]);
    const kindOf = async (q, report) =>
      (
        await q(
          'select kind, kind_override, effective_kind, kind_override_by is not null as by from public.team_raid_reports where team_id = 1 and report_code = $1',
          [report]
        )
      ).rows[0];
    const audits = async (q) =>
      (
        await q(
          "select team_id, actor_id is not null as actor, detail from public.audit_log where action = 'Set Report Kind' order by id"
        )
      ).rows;

    it('sets and clears the override for the attendance permission and site admins, and refuses everyone else', async () => {
      await withTxn(async ({ q, asUser, asAnon }) => {
        const { tuesday } = await planned(q, asUser);
        await kill(q, { report: 'r1', date: tuesday });
        await setKind(asUser, OFFICER_T1, 'r1', 'alt');
        expect(await kindOf(q, 'r1')).toEqual({ kind: 'main', kind_override: 'alt', effective_kind: 'alt', by: true });
        await setKind(asUser, TEAM_LEADER_T1, 'r1', null);
        expect(await kindOf(q, 'r1')).toEqual({ kind: 'main', kind_override: null, effective_kind: 'main', by: false });
        await setKind(asUser, SITE_ADMIN, 'r1', 'main');
        expect((await kindOf(q, 'r1')).kind_override).toBe('main');

        for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
          await q('savepoint refused');
          await expect(setKind(asUser, uid, 'r1', 'alt')).rejects.toThrow(/Not authorized/);
          await q('rollback to savepoint refused');
        }
        await q('savepoint refused');
        await expect(asAnon("select public.set_report_kind(1, 'r1', 'alt')")).rejects.toThrow(/permission denied/);
        await q('rollback to savepoint refused');
        await expect(setKind(asUser, OFFICER_T1, 'r1', 'raid')).rejects.toThrow(/main or alt/);
      });
    });

    // A kill insert holds a key share on its report row before its trigger
    // waits for the lineup lock; set_report_kind() takes the lineup lock and
    // then the row, so a FOR UPDATE there deadlocks with the sync (the
    // fresh-agent review on PR #1944 staged it in two sessions). Two sessions
    // cannot share this suite's rolled-back rows, so the lock mode is pinned.
    it('reads the report row in a mode a kill insert does not block', async () => {
      await withTxn(async ({ q }) => {
        const src = (await q("select prosrc from pg_proc where proname = 'set_report_kind'")).rows[0].prosrc;
        expect(src).toMatch(/for no key update/);
        expect(src).not.toMatch(/for update;/);
      });
    });

    it('refuses a report the team does not have on file', async () => {
      await withTxn(async ({ q, asUser }) => {
        await planned(q, asUser);
        await expect(setKind(asUser, OFFICER_T1, 'nope', 'main')).rejects.toThrow(/not on file/);
      });
    });

    it('takes the bosses a report made main killed off the nights they reach, logged as the skip logs them', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { monday, tuesday } = await planned(q, asUser);
        const id = await kill(q, { report: 'alts', date: tuesday, kind: 'alt' });
        expect((await skippedOn(q, monday))[0]).toEqual([FIRST, false]);
        await setKind(asUser, OFFICER_T1, 'alts', 'main');
        expect((await night(q, monday))[0]).toEqual({
          encounter_id: FIRST,
          position: 1,
          skipped: true,
          confirmed: false,
          players: []
        });
        expect(await reason(q, monday, FIRST)).toBe(id);
        expect((await skipLog(q)).map((e) => [e.actor_id, e.detail.report_code])).toEqual([[null, 'alts']]);
        expect(await audits(q)).toEqual([
          {
            team_id: 1,
            actor: true,
            detail: {
              report_code: 'alts',
              title: null,
              raid_date: tuesday,
              from: 'alt',
              to: 'main',
              old_override: null,
              override: 'main'
            }
          }
        ]);
      });
    });

    it('puts back the bosses a report made alt took off, from their groups, and logs them', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { p1, p2, monday, tuesday } = await planned(q, asUser);
        await kill(q, { report: 'r1', date: tuesday });
        expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
        await setKind(asUser, OFFICER_T1, 'r1', 'alt');
        expect((await night(q, monday))[0]).toEqual({
          encounter_id: FIRST,
          position: 1,
          skipped: false,
          confirmed: false,
          players: [p1, p2]
        });
        expect(await reason(q, monday, FIRST)).toBe(null);
        expect((await audits(q))[0].detail.put_back).toEqual([
          { raid_date: monday, boss: 'First Boss', plan: 'mythic' }
        ]);
      });
    });

    it('leaves a boss an officer put back and skipped by hand since, and a night already played', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { monday, tuesday } = await planned(q, asUser);
        const thursday = await day(q, 2);
        await plan(asUser, OFFICER_T1, thursday);
        await kill(q, { report: 'r1', date: tuesday });
        expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
        // Put back on Monday, then skipped again by hand.
        await skip(asUser, OFFICER_T1, monday, FIRST, false);
        await skip(asUser, OFFICER_T1, monday, FIRST, true);
        // Thursday has been played by the time the report is made alt.
        await pinToday(q, await day(q, 3));
        await setKind(asUser, OFFICER_T1, 'r1', 'alt');
        expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
        expect((await skippedOn(q, thursday))[0]).toEqual([FIRST, true]);
        expect((await audits(q))[0].detail.put_back).toBeUndefined();
      });
    });

    it('keeps a boss off when another main report killed it before the night, naming that kill', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { monday, tuesday } = await planned(q, asUser);
        await kill(q, { report: 'first', date: tuesday, started: `${tuesday} 19:00 America/New_York` });
        const second = await kill(q, { report: 'second', date: tuesday });
        await setKind(asUser, OFFICER_T1, 'first', 'alt');
        expect((await skippedOn(q, monday))[0]).toEqual([FIRST, true]);
        expect(await reason(q, monday, FIRST)).toBe(second);
        const detail = (await audits(q))[0].detail;
        expect(detail.put_back).toBeUndefined();
        expect(detail.kept_off).toEqual([
          { raid_date: monday, boss: 'First Boss', plan: 'mythic', report_code: 'second' }
        ]);
      });
    });

    it('leaves bench and archived raiders out of a boss it puts back, as Put back does', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { p1, p2, monday, tuesday } = await planned(q, asUser);
        await kill(q, { report: 'r1', date: tuesday });
        await q('update public.players set is_bench = true where id = $1', [p2]);
        await setKind(asUser, OFFICER_T1, 'r1', 'alt');
        expect((await night(q, monday))[0].players).toEqual([p1]);
      });
    });

    it('leaves a boss another kill already took off as it is when a report is made main', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { monday, tuesday } = await planned(q, asUser);
        const first = await kill(q, { report: 'r1', date: tuesday, started: `${tuesday} 19:00 America/New_York` });
        await kill(q, { report: 'alts', date: tuesday, kind: 'alt' });
        await setKind(asUser, OFFICER_T1, 'alts', 'main');
        expect(await reason(q, monday, FIRST)).toBe(first);
        expect(await skipLog(q)).toHaveLength(1);
      });
    });

    it('writes nothing when asked for the override the report already has', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { tuesday } = await planned(q, asUser);
        await kill(q, { report: 'r1', date: tuesday });
        await setKind(asUser, OFFICER_T1, 'r1', null);
        await setKind(asUser, OFFICER_T1, 'r1', 'alt');
        const before = (await q("select kind_override_at from public.team_raid_reports where report_code = 'r1'"))
          .rows[0];
        await setKind(asUser, TEAM_LEADER_T1, 'r1', 'alt');
        expect(
          (await q("select kind_override_at from public.team_raid_reports where report_code = 'r1'")).rows[0]
        ).toEqual(before);
        expect(await audits(q)).toHaveLength(1);
      });
    });

    it('records the override it replaced, so clearing one reads as that', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { tuesday } = await planned(q, asUser);
        await kill(q, { report: 'r1', date: tuesday });
        await setKind(asUser, OFFICER_T1, 'r1', 'main');
        await setKind(asUser, OFFICER_T1, 'r1', null);
        expect(
          (await audits(q)).map((a) => [a.detail.from, a.detail.to, a.detail.old_override, a.detail.override])
        ).toEqual([
          ['main', 'main', null, 'main'],
          ['main', 'main', 'main', null]
        ]);
      });
    });

    it('rebuilds the progression card in the same call', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { tuesday } = await planned(q, asUser);
        await kill(q, { report: 'alts', date: tuesday, kind: 'alt' });
        await q(
          `insert into public.team_raid_fights
             (team_id, report_code, fight_id, encounter_id, difficulty, kill, boss_percentage, started_at, ended_at)
           select 1, 'alts', 1, $1, 'mythic', true, 0, r.started_at, r.started_at + interval '5 minutes'
             from public.team_raid_reports r where r.team_id = 1 and r.report_code = 'alts'`,
          [FIRST]
        );
        const progress = async () =>
          (
            await q(
              "select to_char(mythic_date, 'YYYY-MM-DD') as d, mythic_report_code as r from public.team_raid_progress where team_id = 1 and encounter_id = $1",
              [FIRST]
            )
          ).rows[0] ?? null;
        await setKind(asUser, OFFICER_T1, 'alts', 'main');
        expect(await progress()).toEqual({ d: tuesday, r: 'alts' });
        await setKind(asUser, OFFICER_T1, 'alts', 'alt');
        expect((await progress())?.d ?? null).toBe(null);
      });
    });
  });
});

// Which character and spec each raider plays on a boss (#1580): a night's
// lineup and a usual group both carry the pick, every path that copies a
// group onto a night copies it, and a raider's teammates read the alt.
describe('character and spec picks', () => {
  // p1 is RAIDER_T1's Frost Mage (member 3). A teammate of their own (p4, a
  // new member with an account) has a Restoration Shaman alt; RAIDER_T1 has
  // a Fire Mage spec to play and a Shaman alt of their own.
  async function seedPicks(q) {
    const base = await seed(q);
    const specs = (
      await q(`insert into public.classes_specs (class, spec, role)
               values ('Mage', 'Fire', 'Ranged'), ('Shaman', 'Restoration', 'Heal'), ('Shaman', 'Elemental', 'Ranged')
               returning id, spec`)
    ).rows;
    const spec = Object.fromEntries(specs.map((r) => [r.spec, r.id]));
    const mate = await seedMember(q, { teamId: 1 });
    const p4 = await seedPlayer(q, { memberId: mate.memberId });
    const personOf = async (memberId) =>
      (await q('select person_id from public.team_members where id = $1', [memberId])).rows[0].person_id;
    const character = async (memberId, name, cls, sp, id, realm = 'Illidan') =>
      (
        await q(
          `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name)
           values ($1, $2, $3, $4, 'illidan', $5, $6) returning id`,
          [await personOf(memberId), id, name, realm, cls, sp]
        )
      ).rows[0].id;
    const mateAlt = await character(mate.memberId, 'Mateshaman', 'Shaman', 'Restoration', 910001);
    const ownAlt = await character(3, 'Ownshaman', 'Shaman', 'Elemental', 910002);
    const p1Name = (await q('select name_realm from public.players where id = $1', [base.p1])).rows[0].name_realm;
    const [first, ...rest] = p1Name.split('-');
    const p1Self = await character(3, first, 'Mage', 'Frost', 910003, rest.join('-'));
    return { ...base, p4, mate, spec, mateAlt, ownAlt, p1Self };
  }

  const setNightPicks = (asUser, uid, date, encounter, players, picks, expected = null, expectedPicks = null) =>
    asUser(uid, 'select public.set_raid_night_lineup($1, $2, $3, $4::int[], $5::int[], $6::jsonb, $7::jsonb) as n', [
      1,
      date,
      encounter,
      players,
      expected,
      JSON.stringify(picks),
      expectedPicks && JSON.stringify(expectedPicks)
    ]);
  const setGroupPicks = (asUser, uid, encounter, players, picks) =>
    asUser(uid, 'select public.set_boss_group($1, $2, $3::int[], null, $4::jsonb) as n', [
      1,
      encounter,
      players,
      JSON.stringify(picks)
    ]);
  const picksOf = async (q, table, where, params) =>
    (
      await q(
        `select player_id, character_id, class_spec_id from public.${table} where ${where} order by player_id`,
        params
      )
    ).rows;

  it("saves an alt and a spec for a night, keeping the alt's spec as picked", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p4, spec, mateAlt } = await seedPicks(q);
      const night = await today(q, 1);
      await setNightPicks(
        asUser,
        OFFICER_T1,
        night,
        FIRST,
        [p1, p4],
        [
          { player_id: p1, character_id: null, class_spec_id: spec.Fire },
          { player_id: p4, character_id: mateAlt, class_spec_id: spec.Restoration }
        ]
      );
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1 and encounter_id = $2', [night, FIRST])).toEqual([
        { player_id: p1, character_id: null, class_spec_id: spec.Fire },
        // Restoration is the alt's current spec, but it is kept: the alt's
        // spec changes with the raider's next Battle.net save.
        { player_id: p4, character_id: mateAlt, class_spec_id: spec.Restoration }
      ]);
    });
  });

  it("stores picking the raider's own main, in its usual spec, as no pick", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p1Self } = await seedPicks(q);
      const night = await today(q, 1);
      await setNightPicks(
        asUser,
        OFFICER_T1,
        night,
        FIRST,
        [p1],
        [{ player_id: p1, character_id: p1Self, class_spec_id: 1 }]
      );
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p1, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it("refuses a pick for someone not in the lineup, two for one raider, someone else's character, or a spec the class lacks", async () => {
    const cases = [
      [({ p4 }) => [{ player_id: p4, character_id: null, class_spec_id: null }], /not in the lineup/],
      [
        ({ p1, spec }) => [
          { player_id: p1, character_id: null, class_spec_id: spec.Fire },
          { player_id: p1, character_id: null, class_spec_id: 1 }
        ],
        /two picks/
      ],
      [({ p1, mateAlt }) => [{ player_id: p1, character_id: mateAlt, class_spec_id: null }], /isn't one of \S+'s own/],
      [({ p1, spec }) => [{ player_id: p1, character_id: null, class_spec_id: spec.Restoration }], /class has/],
      [({ p1, ownAlt }) => [{ player_id: p1, character_id: ownAlt, class_spec_id: 1 }], /class has/]
    ];
    for (const [picks, message] of cases) {
      await withTxn(async ({ q, asUser }) => {
        const fixture = await seedPicks(q);
        await expect(
          setNightPicks(asUser, OFFICER_T1, await today(q, 1), FIRST, [fixture.p1], picks(fixture))
        ).rejects.toThrow(message);
      });
    }
  });

  it('refuses a save when someone else changed the picks since it was opened', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, spec } = await seedPicks(q);
      const night = await today(q, 1);
      const fire = [{ player_id: p1, character_id: null, class_spec_id: spec.Fire }];
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p1], fire);
      await expect(setNightPicks(asUser, OFFICER_T1, night, FIRST, [p1], [], [p1], [])).rejects.toThrow(
        /Someone else changed/
      );
      // With what it saw, the save goes through.
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p1], [], [p1], fire);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p1, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it("copies a group's picks onto coming nights, planned nights and a boss put back", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p4, spec, mateAlt } = await seedPicks(q);
      const tomorrow = await today(q, 1);
      const nextWeek = await today(q, 7);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p4]);
      await plan(asUser, OFFICER_T1, tomorrow);
      const picked = [
        { player_id: p1, character_id: null, class_spec_id: spec.Fire },
        { player_id: p4, character_id: mateAlt, class_spec_id: null }
      ];
      // An unsaved coming night follows the group's new picks.
      await setGroupPicks(asUser, OFFICER_T1, FIRST, [p1, p4], picked);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [tomorrow])).toEqual(picked);
      // A night planned after copies them.
      await plan(asUser, OFFICER_T1, nextWeek);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [nextWeek])).toEqual(picked);
      // So does putting a skipped boss back, after skipping empties it.
      await asUser(OFFICER_T1, 'select public.set_raid_night_boss_skipped(1, $1, $2, true)', [nextWeek, FIRST]);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [nextWeek])).toEqual([]);
      await asUser(OFFICER_T1, 'select public.set_raid_night_boss_skipped(1, $1, $2, false)', [nextWeek, FIRST]);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [nextWeek])).toEqual(picked);
    });
  });

  it('puts a raider back on their main when the picked alt leaves their character list', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p4, mateAlt, spec } = await seedPicks(q);
      const night = await today(q, 1);
      // On the alt in a spec that isn't its usual, so the spec has to go too.
      const onAlt = [{ player_id: p4, character_id: mateAlt, class_spec_id: spec.Elemental }];
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p4], onAlt);
      await setGroupPicks(asUser, OFFICER_T1, FIRST, [p4], onAlt);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual(onAlt);
      expect(await picksOf(q, 'boss_groups', 'encounter_id = $1', [FIRST])).toEqual(onAlt);
      await q('delete from public.characters where id = $1', [mateAlt]);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p4, character_id: null, class_spec_id: null }
      ]);
      expect(await picksOf(q, 'boss_groups', 'encounter_id = $1', [FIRST])).toEqual([
        { player_id: p4, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it('puts a raider back on their main when the picked alt moves to someone else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p4, mateAlt, spec } = await seedPicks(q);
      const night = await today(q, 1);
      const onAlt = [{ player_id: p4, character_id: mateAlt, class_spec_id: spec.Elemental }];
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p4], onAlt);
      // A refresh that keeps the owner leaves the pick alone.
      await q('update public.characters set item_level = 640 where id = $1', [mateAlt]);
      await q('update public.characters set person_id = person_id where id = $1', [mateAlt]);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual(onAlt);
      await q(
        'update public.characters set person_id = (select person_id from public.team_members where id = 3) where id = $1',
        [mateAlt]
      );
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p4, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it("refuses a same-name character with a spec its roster row's class lacks", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, spec } = await seedPicks(q);
      // A Shaman saved under the roster Mage's own name.
      const p1Name = (await q('select name_realm from public.players where id = $1', [p1])).rows[0].name_realm;
      const [first, ...rest] = p1Name.split('-');
      await q("update public.characters set name = 'Gone' where blizzard_id = 910003");
      const twin = (
        await q(
          `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name)
           values ((select person_id from public.team_members where id = 3), 910004, $1, $2, 'illidan', 'Shaman', 'Restoration')
           returning id`,
          [first, rest.join('-')]
        )
      ).rows[0].id;
      await expect(
        setNightPicks(
          asUser,
          OFFICER_T1,
          await today(q, 1),
          FIRST,
          [p1],
          [{ player_id: p1, character_id: twin, class_spec_id: spec.Restoration }]
        )
      ).rejects.toThrow(/class has/);
    });
  });

  it('refuses a save that leaves picks out when the boss has some, and lets an empty list clear them', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, spec } = await seedPicks(q);
      const night = await today(q, 1);
      await setNightPicks(
        asUser,
        OFFICER_T1,
        night,
        FIRST,
        [p1],
        [{ player_id: p1, character_id: null, class_spec_id: spec.Fire }]
      );
      // A page from before picks: the old arguments only.
      await expect(
        asUser(OFFICER_T1, 'select public.set_raid_night_lineup($1, $2, $3, $4::int[], $5::int[])', [
          1,
          night,
          FIRST,
          [p1],
          [p1]
        ])
      ).rejects.toThrow(/Someone else changed/);
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p1], []);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p1, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it("refuses a valid pick from a raider, another team's officer, and someone signed out", async () => {
    const callers = [
      ['a raider', (asUser, text, params) => asUser(RAIDER_T1, text, params), /Not authorized/],
      ["another team's officer", (asUser, text, params) => asUser(OFFICER_T2, text, params), /Not authorized/],
      ['someone signed out', (asUser, text, params, asAnon) => asAnon(text, params), /permission denied|Not signed in/]
    ];
    for (const [, run, message] of callers) {
      await withTxn(async ({ q, asUser, asAnon }) => {
        const { p1, spec } = await seedPicks(q);
        const night = await today(q, 1);
        const fire = JSON.stringify([{ player_id: p1, character_id: null, class_spec_id: spec.Fire }]);
        await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
        await plan(asUser, OFFICER_T1, night);
        await expect(
          run(
            asUser,
            'select public.set_raid_night_lineup(1, $1, $2, $3::int[], null, $4::jsonb)',
            [night, FIRST, [p1], fire],
            asAnon
          )
        ).rejects.toThrow(message);
        await expect(
          run(asUser, 'select public.set_boss_group(1, $1, $2::int[], null, $3::jsonb)', [FIRST, [p1], fire], asAnon)
        ).rejects.toThrow(message);
        expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
          { player_id: p1, character_id: null, class_spec_id: null }
        ]);
        expect(await picksOf(q, 'boss_groups', 'encounter_id = $1', [FIRST])).toEqual([
          { player_id: p1, character_id: null, class_spec_id: null }
        ]);
      });
    }
  });

  it('clears picks when an officer unlinks a roster row directly, as the current site does', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p4, mateAlt } = await seedPicks(q);
      const night = await today(q, 1);
      const onAlt = [{ player_id: p4, character_id: mateAlt, class_spec_id: null }];
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p4], onAlt);
      await setGroupPicks(asUser, OFFICER_T1, FIRST, [p4], onAlt);
      await asUser(OFFICER_T1, 'update public.players set team_member_id = null where id = $1', [p4]);
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual([
        { player_id: p4, character_id: null, class_spec_id: null }
      ]);
      expect(await picksOf(q, 'boss_groups', 'encounter_id = $1', [FIRST])).toEqual([
        { player_id: p4, character_id: null, class_spec_id: null }
      ]);
    });
  });

  it('asks for a reload when the picked alt is already gone', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p4, mateAlt } = await seedPicks(q);
      await q('delete from public.characters where id = $1', [mateAlt]);
      await expect(
        setNightPicks(
          asUser,
          OFFICER_T1,
          await today(q, 1),
          FIRST,
          [p4],
          [{ player_id: p4, character_id: mateAlt, class_spec_id: null }]
        )
      ).rejects.toThrow(/Reload/);
    });
  });

  it('drops alt picks when a roster row moves to another person, keeping a spec pick', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p4, mateAlt, spec } = await seedPicks(q);
      const night = await today(q, 1);
      const picked = [
        { player_id: p1, character_id: null, class_spec_id: spec.Fire },
        { player_id: p4, character_id: mateAlt, class_spec_id: null }
      ];
      await setNightPicks(asUser, OFFICER_T1, night, FIRST, [p1, p4], picked);
      await setGroupPicks(asUser, OFFICER_T1, FIRST, [p1, p4], picked);
      expect((await asUser(RAIDER_T1, 'select id from public.characters where id = $1', [mateAlt])).rows).toEqual([
        { id: mateAlt }
      ]);
      // p4's roster row goes to another person (as add_signup_to_roster() can).
      const other = await seedMember(q, { teamId: 1 });
      await q('update public.players set team_member_id = $1 where id = $2', [other.memberId, p4]);
      const after = [
        { player_id: p1, character_id: null, class_spec_id: spec.Fire },
        { player_id: p4, character_id: null, class_spec_id: null }
      ];
      expect(await picksOf(q, 'raid_night_lineups', 'raid_date = $1', [night])).toEqual(after);
      expect(await picksOf(q, 'boss_groups', 'encounter_id = $1', [FIRST])).toEqual(after);
      // And teammates no longer read the old person's alt.
      expect((await asUser(RAIDER_T1, 'select id from public.characters where id = $1', [mateAlt])).rows).toEqual([]);
    });
  });

  it('lets a teammate read an alt picked for their team, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p4, mateAlt } = await seedPicks(q);
      const read = (uid) => asUser(uid, 'select id from public.characters where id = $1', [mateAlt]);
      // Not picked yet: a teammate reads nothing.
      expect((await read(RAIDER_T1)).rows).toEqual([]);
      await setNightPicks(
        asUser,
        OFFICER_T1,
        await today(q, 1),
        FIRST,
        [p4],
        [{ player_id: p4, character_id: mateAlt, class_spec_id: null }]
      );
      expect((await read(RAIDER_T1)).rows).toEqual([{ id: mateAlt }]);
      // Another team's raider still doesn't.
      expect((await read(RAIDER_T2)).rows).toEqual([]);
    });
  });
});

describe('a Heroic plan and a Mythic plan (#1688)', () => {
  const setPlanGroup = (asUser, uid, encounter, players, plan) =>
    asUser(uid, 'select public.set_boss_group($1, $2, $3::int[], null, null, null, $4) as n', [
      1,
      encounter,
      players,
      plan
    ]);

  // Each boss on a night, by half, with its lineup as sorted player ids.
  const halves = async (q, date) =>
    (
      await q(
        `select b.plan, b.encounter_id, b.position, b.skipped,
                coalesce((select array_agg(l.player_id order by l.player_id) from public.raid_night_lineups l
                          where l.team_id = b.team_id and l.raid_date = b.raid_date
                            and l.encounter_id = b.encounter_id and l.plan = b.plan), '{}') as players
           from public.raid_night_bosses b
          where b.team_id = 1 and b.raid_date = $1
          order by b.plan, b.position`,
        [date]
      )
    ).rows;

  const planGroup = async (q, encounter, plan) =>
    (
      await q(
        `select coalesce(array_agg(player_id order by player_id), '{}') as p from public.boss_groups
          where team_id = 1 and encounter_id = $1 and plan = $2`,
        [encounter, plan]
      )
    ).rows[0].p;

  it('keeps each plan’s group apart, and refuses a plan that is neither', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1, p2]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p2], 'heroic');
      expect(await planGroup(q, FIRST, 'mythic')).toEqual([p1, p2]);
      expect(await planGroup(q, FIRST, 'heroic')).toEqual([p2]);
      await expect(setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'normal')).rejects.toThrow(
        'Pick the Heroic or the Mythic plan.'
      );
    });
  });

  it('fills a Heroic into Mythic night with both halves, each from its own plan', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1, p2], 'heroic');
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      expect(await halves(q, date)).toEqual([
        { plan: 'heroic', encounter_id: FIRST, position: 1, skipped: false, players: [p1, p2] },
        { plan: 'mythic', encounter_id: FIRST, position: 1, skipped: false, players: [p1] },
        { plan: 'mythic', encounter_id: SECOND, position: 2, skipped: false, players: [p1] }
      ]);
    });
  });

  it('fills a Heroic night from the Heroic plan only, and a Mythic night from the Mythic plan only', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setPlanGroup(asUser, OFFICER_T1, SECOND, [p2], 'heroic');
      await setTeamDifficulty(q, 'heroic');
      const heroic = await today(q, 1);
      await plan(asUser, OFFICER_T1, heroic);
      expect(await halves(q, heroic)).toEqual([
        { plan: 'heroic', encounter_id: SECOND, position: 1, skipped: false, players: [p2] }
      ]);
      await setTeamDifficulty(q, 'mythic');
      const mythic = await today(q, 2);
      await plan(asUser, OFFICER_T1, mythic);
      expect(await halves(q, mythic)).toEqual([
        { plan: 'mythic', encounter_id: FIRST, position: 1, skipped: false, players: [p1] }
      ]);
    });
  });

  it('saves one half of a night without touching the other, and refuses a half the night is not raided at', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      await asUser(OFFICER_T1, 'select public.set_raid_night_lineup(1, $1, $2, $3::int[], null, null, null, $4)', [
        date,
        FIRST,
        [p1, p2],
        'heroic'
      ]);
      expect(await halves(q, date)).toEqual([
        { plan: 'heroic', encounter_id: FIRST, position: 1, skipped: false, players: [p1, p2] },
        { plan: 'mythic', encounter_id: FIRST, position: 1, skipped: false, players: [p1] }
      ]);

      await setTeamDifficulty(q, 'mythic');
      const mythic = await today(q, 2);
      await expect(
        asUser(OFFICER_T1, 'select public.set_raid_night_lineup(1, $1, $2, $3::int[], null, null, null, $4)', [
          mythic,
          FIRST,
          [p1],
          'heroic'
        ])
      ).rejects.toThrow("That night isn't raided on that difficulty.");
    });
  });

  it('skips a boss on the half run at the kill’s difficulty only', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'heroic');
      const tuesday = await day(q, 0);
      await pinToday(q, tuesday);
      const monday = await day(q, 6);
      await plan(asUser, OFFICER_T1, monday);
      await kill(q, { difficulty: 'heroic', report: 'r1', date: tuesday });
      expect((await halves(q, monday)).map((b) => [b.plan, b.skipped, b.players])).toEqual([
        ['heroic', true, []],
        ['mythic', false, [p1]]
      ]);
    });
  });

  it('records who was in for each half apart', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'heroic');
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      await asUser(OFFICER_T1, 'select public.record_raid_night_participation(1, $1, $2, $3::int[], $4)', [
        date,
        FIRST,
        [p1, p2],
        'heroic'
      ]);
      await asUser(OFFICER_T1, 'select public.record_raid_night_participation(1, $1, $2, $3::int[], $4)', [
        date,
        FIRST,
        [p1],
        'mythic'
      ]);
      const rows = await q(
        `select plan, array_agg(player_id order by player_id) as p from public.raid_night_participation
          where team_id = 1 and raid_date = $1 group by plan order by plan`,
        [date]
      );
      expect(rows.rows).toEqual([
        { plan: 'heroic', p: [p1, p2] },
        { plan: 'mythic', p: [p1] }
      ]);
    });
  });

  it("refuses a raider, another team's officer and a signed-out caller on the Heroic half", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'heroic');
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      const sql = 'select public.record_raid_night_participation(1, $1, $2, $3::int[], $4)';
      await asUser(OFFICER_T1, sql, [date, FIRST, [p1], 'heroic']);
      for (const uid of [RAIDER_T1, OFFICER_T2]) {
        await expect(asUser(uid, sql, [date, FIRST, [p1, p2], 'heroic'])).rejects.toThrow(/Not authorized/);
      }
      await expect(asAnon(sql, [date, FIRST, [p1, p2], 'heroic'])).rejects.toThrow(/permission denied/);
      const rows = await q(
        `select array_agg(player_id) as p from public.raid_night_participation
          where team_id = 1 and raid_date = $1 and plan = 'heroic'`,
        [date]
      );
      expect(rows.rows[0].p).toEqual([p1]);
    });
  });

  it('adds a missing half to a night already filled, in its pull order, counting bosses once', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1, p2 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
      const date = await today(q, 1);
      expect((await plan(asUser, OFFICER_T1, date)).rows[0].n).toBe(2);
      // The night's order is changed, then the Heroic plan gets its groups.
      await asUser(OFFICER_T1, 'select public.set_raid_night_boss_order(1, $1, $2::int[], $3::int[])', [
        date,
        [SECOND, FIRST],
        [FIRST, SECOND]
      ]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p2], 'heroic');
      await setPlanGroup(asUser, OFFICER_T1, SECOND, [p2], 'heroic');
      expect((await plan(asUser, OFFICER_T1, date)).rows[0].n).toBe(2);
      expect((await halves(q, date)).map((b) => [b.plan, b.encounter_id, b.position, b.players])).toEqual([
        ['heroic', SECOND, 1, [p2]],
        ['heroic', FIRST, 2, [p2]],
        ['mythic', SECOND, 1, [p1]],
        ['mythic', FIRST, 2, [p1]]
      ]);
      // Nothing left to add.
      expect((await plan(asUser, OFFICER_T1, date)).rows[0].n).toBe(0);
    });
  });

  it('saves a pull order from one half, a boss only on the other half keeping its place', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'heroic');
      await setPlanGroup(asUser, OFFICER_T1, SECOND, [p1], 'heroic');
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      const sql = 'select public.set_raid_night_boss_order(1, $1, $2::int[], $3::int[], false, $4)';
      // The Mythic half lists only its own boss.
      await asUser(OFFICER_T1, sql, [date, [FIRST], [FIRST], 'mythic']);
      await asUser(OFFICER_T1, sql, [date, [SECOND, FIRST], [FIRST, SECOND], 'heroic']);
      expect((await halves(q, date)).map((b) => [b.plan, b.encounter_id, b.position])).toEqual([
        ['heroic', SECOND, 1],
        ['heroic', FIRST, 2],
        ['mythic', FIRST, 2]
      ]);
      await expect(asUser(OFFICER_T1, sql, [date, [FIRST], [FIRST], 'normal'])).rejects.toThrow(/Heroic or the Mythic/);
      await expect(asUser(OFFICER_T1, sql, [date, [FIRST, SECOND], [SECOND, FIRST], 'mythic'])).rejects.toThrow(
        /changed this night/
      );
    });
  });

  it('keeps a boss only on the other half in place on later nights when the order is for every night', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      // FIRST is on the Heroic half only; SECOND on both.
      await setPlanGroup(asUser, OFFICER_T1, FIRST, [p1], 'heroic');
      await setPlanGroup(asUser, OFFICER_T1, SECOND, [p1], 'heroic');
      await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
      const date = await today(q, 1);
      const later = await today(q, 8);
      await plan(asUser, OFFICER_T1, date);
      await plan(asUser, OFFICER_T1, later);
      // A Mythic save of its one boss, for every night, leaves FIRST first.
      await asUser(OFFICER_T1, 'select public.set_raid_night_boss_order(1, $1, $2::int[], $3::int[], true, $4)', [
        date,
        [SECOND],
        [SECOND],
        'mythic'
      ]);
      const order = async (d) =>
        (
          await q(
            `select array_agg(encounter_id order by position, encounter_id) as ids
               from (select encounter_id, min(position) as position from public.raid_night_bosses
                      where team_id = 1 and raid_date = $1 group by encounter_id) b`,
            [d]
          )
        ).rows[0].ids;
      expect(await order(date)).toEqual([FIRST, SECOND]);
      expect(await order(later)).toEqual([FIRST, SECOND]);
    });
  });

  it('keeps one pull order when a half has no group for a boss', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { p1 } = await seed(q);
      await setTeamDifficulty(q, 'heroic_into_mythic');
      await setGroup(asUser, OFFICER_T1, FIRST, [p1]);
      await setGroup(asUser, OFFICER_T1, SECOND, [p1]);
      // Heroic has the second boss only: it keeps place 2, not 1.
      await setPlanGroup(asUser, OFFICER_T1, SECOND, [p1], 'heroic');
      const date = await today(q, 1);
      await plan(asUser, OFFICER_T1, date);
      expect((await halves(q, date)).map((b) => [b.plan, b.encounter_id, b.position])).toEqual([
        ['heroic', SECOND, 2],
        ['mythic', FIRST, 1],
        ['mythic', SECOND, 2]
      ]);
      await asUser(OFFICER_T1, 'select public.set_raid_night_boss_order(1, $1, $2::int[], $3::int[])', [
        date,
        [SECOND, FIRST],
        [FIRST, SECOND]
      ]);
      expect((await halves(q, date)).map((b) => [b.plan, b.encounter_id, b.position])).toEqual([
        ['heroic', SECOND, 1],
        ['mythic', SECOND, 1],
        ['mythic', FIRST, 2]
      ]);
    });
  });
});
