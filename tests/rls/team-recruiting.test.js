// #1535: a team's recruiting settings and open spots, changed by its officers
// through functions and read by the public apply pages through one more.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, OFFICER_T1, OFFICER_T2, RAIDER_T1, TEAM_LEADER_T1, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const settings = async (asUser, uid, team = 1) =>
  (await asUser(uid, 'select public.team_recruiting_settings($1) as s', [team])).rows[0].s;
const save = (asUser, uid, changes, team = 1) =>
  asUser(uid, 'select public.save_team_recruiting($1, $2)', [team, JSON.stringify(changes)]);
const setSpots = (asUser, uid, spots, team = 1) =>
  asUser(uid, 'select public.set_team_recruiting_spots($1, $2)', [team, JSON.stringify(spots)]);
const page = async (run, team = null) =>
  (await run("select public.team_recruiting_page('wga', $1) as p", [team])).rows[0].p;
const audits = async (q, team = 1) =>
  (
    await q(
      "select action, detail from public.audit_log where team_id = $1 and action like 'Recruiting %' order by id",
      [team]
    )
  ).rows;
// The seed has one spec; each test adds the ones it needs.
const specId = async (q, cls, spec, role) =>
  (await q('insert into public.classes_specs (class, spec, role) values ($1, $2, $3) returning id', [cls, spec, role]))
    .rows[0].id;

describe('team recruiting', () => {
  it('every team has a row with recruiting off, and a new team gets one too', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await settings(asUser, OFFICER_T1)).toMatchObject({
        taking_applications: false,
        join_method: 'application',
        discord_mode: 'none',
        listed_on_guild_page: true,
        trial_days: 14,
        dm_reply_after_minutes: 120,
        spots: []
      });
      const team = await seedTeam(q);
      expect(await settings(asUser, team.officer.uid, team.teamId)).toMatchObject({
        taking_applications: false,
        discord_mode: 'none'
      });
      // A site admin reads any team's.
      expect((await settings(asUser, SITE_ADMIN, 3)).trial_days).toBe(14);
    });
  });

  it('an Officer or the Team Owner changes only the fields named, and each change is logged once', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, OFFICER_T1, {
        taking_applications: true,
        trial_days: 21,
        raid_languages: ['English', 'German']
      });
      await save(asUser, TEAM_LEADER_T1, { about: 'We raid **hard**.' });
      // The same values again change nothing and log nothing.
      await save(asUser, OFFICER_T1, { trial_days: 21 });

      const s = await settings(asUser, OFFICER_T1);
      expect(s).toMatchObject({
        taking_applications: true,
        trial_days: 21,
        raid_languages: ['English', 'German'],
        about: 'We raid **hard**.',
        min_item_level: null
      });
      const log = await audits(q);
      expect(log.map((r) => r.action)).toEqual(['Recruiting Settings Changed', 'Recruiting Settings Changed']);
      expect(log[0].detail).toEqual({
        taking_applications: { from: false, to: true },
        trial_days: { from: 14, to: 21 },
        raid_languages: { from: [], to: ['English', 'German'] }
      });
    });
  });

  it('refuses a setting that is not one, and every limit', async () => {
    await withTxn(async ({ asUser }) => {
      const bad = [
        [{ team_id: 2 }, /not a recruiting setting: team_id/],
        [{ nope: 1 }, /not a recruiting setting: nope/],
        [{ about: 'x'.repeat(2001) }, /team_recruiting_about/],
        [{ schedule_note: 'two\nlines' }, /team_recruiting_schedule_note/],
        [{ join_method: 'email' }, /team_recruiting_join_method/],
        [{ trial_days: 0 }, /team_recruiting_trial_days/],
        [{ attendance_percent: 101 }, /team_recruiting_attendance_percent/],
        [{ raid_languages: ['a', 'b', 'c', 'd', 'e', 'f'] }, /team_recruiting_raid_languages/],
        [{ visible_to_role_ids: ['123'] }, /team_recruiting_visible_to_role_ids/],
        // Each item is checked on its own, so two ids can't pass as one.
        [{ visible_to_role_ids: ['300000000000000001,300000000000000002'] }, /team_recruiting_visible_to_role_ids/],
        [{ raid_languages: ['English', ''] }, /team_recruiting_raid_languages/],
        [{ raid_languages: ['English', null] }, /team_recruiting_raid_languages/],
        [{ ticket_link: 'http://example.com' }, /team_recruiting_ticket_link/],
        [{ discord_mode: 'ticket' }, /team_recruiting_ticket_adds_to_server/],
        [{ remind_after_hours: 200 }, /team_recruiting_remind_before_close/],
        [{ ping_owner_after_hours: 12 }, /team_recruiting_owner_after_officers/],
        [{ join_method: 'discord_ticket', taking_applications: true }, /team_recruiting_ticket_needs_link/],
        [{ officer_thread_with_ticket: true }, /team_recruiting_thread_with_ticket/]
      ];
      for (const [changes, error] of bad) {
        await expect(save(asUser, OFFICER_T1, changes)).rejects.toThrow(error);
      }
      // A timing can be emptied for never.
      await save(asUser, OFFICER_T1, { close_no_reply_after_hours: null });
      expect((await settings(asUser, OFFICER_T1)).close_no_reply_after_hours).toBeNull();
    });
  });

  it('replaces the spot list in order, taking role from the spec, and refuses doubles and a wrong role', async () => {
    await withTxn(async ({ q, asUser }) => {
      const resto = await specId(q, 'Shaman', 'Restoration', 'Heal');
      const balance = await specId(q, 'Druid', 'Balance', 'Ranged');
      await setSpots(asUser, OFFICER_T1, [
        { class_spec_id: resto, priority: 'high' },
        { class_spec_id: balance, priority: 'high' },
        { role: 'ranged', priority: 'low' }
      ]);
      expect((await settings(asUser, OFFICER_T1)).spots).toEqual([
        { role: 'healer', class_spec_id: resto, class: 'Shaman', spec: 'Restoration', priority: 'high' },
        { role: 'ranged', class_spec_id: balance, class: 'Druid', spec: 'Balance', priority: 'high' },
        { role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'low' }
      ]);
      // The same list again logs nothing.
      await setSpots(asUser, OFFICER_T1, [
        { class_spec_id: resto, priority: 'high' },
        { class_spec_id: balance, priority: 'high' },
        { role: 'ranged', priority: 'low' }
      ]);
      expect((await audits(q)).map((r) => r.action)).toEqual(['Recruiting Spots Changed']);

      const bad = [
        [
          [
            { class_spec_id: resto, priority: 'high' },
            { class_spec_id: resto, priority: 'low' }
          ],
          /twice/
        ],
        [
          [
            { role: 'tank', priority: 'high' },
            { role: 'tank', priority: 'low' }
          ],
          /twice/
        ],
        [[{ class_spec_id: resto, role: 'tank', priority: 'high' }], /healer spec/],
        [[{ role: 'dps', priority: 'high' }], /needs tank, healer, melee or ranged/],
        [[{ role: 'tank', priority: 'urgent' }], /check/],
        [Array.from({ length: 41 }, () => ({ role: 'tank', priority: 'low' })), /at most 40/]
      ];
      for (const [spots, error] of bad) {
        await expect(setSpots(asUser, OFFICER_T1, spots)).rejects.toThrow(error);
      }
      // A refused save leaves the list as it was.
      expect((await settings(asUser, OFFICER_T1)).spots).toHaveLength(3);
    });
  });

  it("refuses raiders, assistants, another team's officers and signed-out visitors", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const team = await seedTeam(q);
      await q("update public.team_members set rank = 'assistant' where id = $1", [team.raider.memberId]);
      const calls = [
        ['select public.team_recruiting_settings($1)', [team.teamId]],
        ['select public.save_team_recruiting($1, \'{"trial_days": 7}\')', [team.teamId]],
        ["select public.set_team_recruiting_spots($1, '[]')", [team.teamId]]
      ];
      for (const [sql, params] of calls) {
        await expect(asUser(team.raider.uid, sql, params)).rejects.toThrow(/Not authorized/);
        await expect(asUser(RAIDER_T1, sql, params)).rejects.toThrow(/Not authorized/);
        await expect(asUser(OFFICER_T2, sql, params)).rejects.toThrow(/Not authorized/);
        await expect(asAnon(sql, params)).rejects.toThrow(/permission denied/);
      }
      // Nobody reads the tables directly.
      for (const table of ['team_recruiting', 'team_recruiting_spots']) {
        await expect(asUser(OFFICER_T1, `select * from public.${table}`)).rejects.toThrow(/permission denied/);
        await expect(asAnon(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
      }
      // Taking the grid row off a team's Officers locks them out.
      await q("delete from public.team_rank_permissions where team_id = $1 and permission = 'edit_recruiting'", [
        team.teamId
      ]);
      for (const [sql, params] of calls) {
        await expect(asUser(team.officer.uid, sql, params)).rejects.toThrow(/Not authorized/);
      }
    });
  });

  it('the apply page shows a listed or open team to anyone, with spots, nights and progress, and no Discord settings', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const resto = await specId(q, 'Shaman', 'Restoration', 'Heal');
      await setSpots(asUser, OFFICER_T1, [{ class_spec_id: resto, priority: 'high' }]);
      await save(asUser, OFFICER_T1, {
        taking_applications: true,
        exceptional_line_on: true,
        visible_to_role_ids: ['300000000000000001']
      });
      await q("insert into public.raid_schedule (team_id, weekday, start_time) values (1, 2, '20:00')");
      const zone = (
        await q(
          "insert into public.raid_zones (wcl_zone_id, name, season) values (9001, 'Test Zone', 'seed-season') returning id"
        )
      ).rows[0].id;
      const boss = (
        await q(
          "insert into public.raid_encounters (zone_id, wcl_encounter_id, name) values ($1, 9002, 'Test Boss') returning id",
          [zone]
        )
      ).rows[0].id;
      await q(
        "insert into public.team_raid_progress (team_id, encounter_id, heroic_date, mythic_best_pct) values (1, $1, '2026-11-01', 42.5)",
        [boss]
      );

      const list = await page(asAnon);
      expect(list.map((t) => t.slug)).toEqual(['hellfire', 'immolation', 'phoenix']);
      const phoenix = list.find((t) => t.slug === 'phoenix');
      expect(phoenix).toMatchObject({
        taking_applications: true,
        exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
        spots: [expect.objectContaining({ spec: 'Restoration', priority: 'high' })]
      });
      expect(phoenix.nights).toContainEqual(expect.objectContaining({ weekday: 2, start_time: '20:00:00' }));
      expect(phoenix.progress).toEqual([
        expect.objectContaining({
          zone: 'Test Zone',
          boss: 'Test Boss',
          heroic_date: '2026-11-01',
          mythic_best_pct: 42.5
        })
      ]);
      expect(Object.keys(phoenix).filter((k) => /discord|visible|ticket_category|after_/.test(k))).toEqual([]);
      // Hidden line stays hidden.
      expect(list.find((t) => t.slug === 'hellfire').exceptional_line).toBeNull();

      // Unlisted but open: off the list, still on its own link.
      await save(asUser, OFFICER_T1, { listed_on_guild_page: false });
      expect((await page(asAnon)).map((t) => t.slug)).not.toContain('phoenix');
      expect((await page(asAnon, 'phoenix')).map((t) => t.slug)).toEqual(['phoenix']);
      // Unlisted and closed: gone.
      await save(asUser, OFFICER_T1, { taking_applications: false });
      expect(await page(asAnon, 'phoenix')).toEqual([]);
      // Archived teams never show.
      await q('update public.teams set archived_at = now() where id = 2');
      expect((await page(asAnon)).map((t) => t.slug)).toEqual(['immolation']);
    });
  });
});
