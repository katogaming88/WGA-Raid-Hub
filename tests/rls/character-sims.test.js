// save_character_sim() and delete_character_sim() (#1443, #1916, #1888): a raider, or an
// officer who manages the team's loot, saves a droptimizer sim; one per
// character per difficulty, a new one replacing the old. Anyone reads them.
// Each case mints its own team; everything is rolled back.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, seedMember, RLS_DENIED, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const result = (overrides) => ({
  wow_item_id: 268252,
  item_name: 'Band of the Abyss',
  slot: 'finger1',
  item_level: 334,
  pct_gain: 1.98,
  dps_gain: 4335,
  encounter_id: 2871,
  catalyst_from: null,
  ...overrides
});

const save = (
  asUser,
  uid,
  playerId,
  {
    difficulty = 'mythic',
    spec = 1,
    source = 'raidbots',
    reportId = 'abc123',
    // The report's character, as the page read it.
    character = ['Simmer', 'illidan'],
    // Its setup (#1888): fight style, targets, fight length in seconds.
    setup = ['Patchwerk', 1, 300],
    results
  } = {}
) =>
  asUser(uid, 'select public.save_character_sim($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11::jsonb) as n', [
    playerId,
    difficulty,
    spec,
    source,
    reportId,
    ...character,
    ...setup,
    JSON.stringify(results ?? [result(), result({ slot: 'finger2', pct_gain: 1.9 })])
  ]).then((r) => r.rows[0].n);

// Removes by the sim's id (#1888), found by its difficulty and spec.
const remove = (asUser, uid, playerId, difficulty = 'mythic', spec = 1) =>
  asUser(
    uid,
    `select public.delete_character_sim(id) from public.character_sims
      where player_id = $1 and difficulty = $2 and class_spec_id = $3`,
    [playerId, difficulty, spec]
  );

async function raiderWithCharacter(q) {
  const team = await seedTeam(q);
  const playerId = await seedPlayer(q, {
    teamId: team.teamId,
    memberId: team.raider.memberId,
    nameRealm: 'Simmer-Illidan'
  });
  return { team, playerId };
}

// A spec for the test, made if the seed lacks it (#1916). The seed's spec 1 is
// Frost Mage, every seeded character's.
const specId = async (q, cls, spec) =>
  (
    await q(
      `insert into public.classes_specs (class, spec, role) values ($1, $2, 'Ranged')
       on conflict do nothing returning id`,
      [cls, spec]
    )
  ).rows[0]?.id ??
  (await q('select id from public.classes_specs where class = $1 and spec = $2', [cls, spec])).rows[0].id;

const simsOf = async (q, playerId) =>
  (
    await q(
      `select s.difficulty, s.class_spec_id as spec, s.source, s.report_id, count(r.id)::int as results
         from public.character_sims s left join public.character_sim_results r on r.sim_id = s.id
        where s.player_id = $1 group by s.id order by s.difficulty, s.class_spec_id`,
      [playerId]
    )
  ).rows;

describe('save_character_sim()', () => {
  it('saves the raider’s own sim with every result, and logs it', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      expect(await save(asUser, team.raider.uid, playerId)).toBe(2);
      expect(await simsOf(q, playerId)).toEqual([
        { difficulty: 'mythic', spec: 1, source: 'raidbots', report_id: 'abc123', results: 2 }
      ]);
      const audit = await q(`select actor_id from public.audit_log where action = 'Sim Added' and target_id = $1`, [
        playerId
      ]);
      expect(audit.rows).toEqual([{ actor_id: team.raider.uid }]);
    }));

  it('replaces the sim at the same difficulty and keeps the other difficulties', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      await save(asUser, team.raider.uid, playerId, { reportId: 'first' });
      await save(asUser, team.raider.uid, playerId, { difficulty: 'heroic', reportId: 'hero' });
      await save(asUser, team.raider.uid, playerId, {
        source: 'qe_live',
        reportId: 'second',
        results: [result({ slot: null, dps_gain: null })]
      });
      expect(await simsOf(q, playerId)).toEqual([
        { difficulty: 'heroic', spec: 1, source: 'raidbots', report_id: 'hero', results: 2 },
        { difficulty: 'mythic', spec: 1, source: 'qe_live', report_id: 'second', results: 1 }
      ]);
    }));

  // #1916: the character is Frost (1); Fire is another Mage spec.
  it('keeps a sim per spec at the same difficulty, a new one replacing only its own spec’s', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const fire = await specId(q, 'Mage', 'Fire');
      await save(asUser, team.raider.uid, playerId, { reportId: 'frost' });
      await save(asUser, team.raider.uid, playerId, { spec: fire, reportId: 'fire' });
      await save(asUser, team.raider.uid, playerId, { spec: fire, reportId: 'fire2', results: [result()] });
      expect(await simsOf(q, playerId)).toEqual([
        { difficulty: 'mythic', spec: 1, source: 'raidbots', report_id: 'frost', results: 2 },
        { difficulty: 'mythic', spec: fire, source: 'raidbots', report_id: 'fire2', results: 1 }
      ]);
      const audit = await q(
        `select detail->>'summary' as s from public.audit_log where action = 'Sim Added' and target_id = $1 order by id`,
        [playerId]
      );
      expect(audit.rows.map((r) => r.s)).toEqual([
        'Mythic Frost sim from Raidbots (Patchwerk, 1 target, 5 min), 2 results',
        'Mythic Fire sim from Raidbots (Patchwerk, 1 target, 5 min), 2 results',
        'Mythic Fire sim from Raidbots (Patchwerk, 1 target, 5 min), 1 results'
      ]);
    }));

  it('refuses a spec of another class, or one that doesn’t exist', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const havoc = await specId(q, 'Demon Hunter', 'Havoc');
      await expect(save(asUser, team.raider.uid, playerId, { spec: havoc })).rejects.toThrow(/another class|class/i);
      await expect(save(asUser, team.raider.uid, playerId, { spec: 99999 })).rejects.toThrow(/class/i);
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // #1888: one sim per setup. Another fight style, target count or length
  // is another sim; the same three replace it. QE Live (no setup) is one.
  it('keeps a sim per setup, a new one replacing only the same setup’s', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const uid = team.raider.uid;
      await save(asUser, uid, playerId, { reportId: 'single' });
      await save(asUser, uid, playerId, { reportId: 'aoe', setup: ['Patchwerk', 3, 300] });
      await save(asUser, uid, playerId, { reportId: 'long', setup: ['Patchwerk', 1, 420] });
      await save(asUser, uid, playerId, { reportId: 'single2', results: [result()] });
      await save(asUser, uid, playerId, { source: 'qe_live', reportId: 'qe1', setup: [null, null, null] });
      await save(asUser, uid, playerId, { source: 'qe_live', reportId: 'qe2', setup: [null, null, null] });
      const kept = await q(
        `select report_id, fight_style, target_count, fight_length from public.character_sims
          where player_id = $1 order by report_id`,
        [playerId]
      );
      expect(kept.rows).toEqual([
        { report_id: 'aoe', fight_style: 'Patchwerk', target_count: 3, fight_length: 300 },
        { report_id: 'long', fight_style: 'Patchwerk', target_count: 1, fight_length: 420 },
        { report_id: 'qe2', fight_style: null, target_count: null, fight_length: null },
        { report_id: 'single2', fight_style: 'Patchwerk', target_count: 1, fight_length: 300 }
      ]);
    }));

  // The fresh-agent review on PR #1921: at most ten sims per difficulty and
  // spec, so nobody can flood the team's Priority page. Replacing one is fine.
  it('refuses an eleventh setup at one difficulty and spec, but replaces one already there', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const uid = team.raider.uid;
      for (let n = 1; n <= 10; n++)
        await save(asUser, uid, playerId, { setup: ['Patchwerk', n, 300], results: [result()] });
      await expect(save(asUser, uid, playerId, { setup: ['Patchwerk', 11, 300] })).rejects.toThrow(/ten sims/i);
      expect(await save(asUser, uid, playerId, { setup: ['Patchwerk', 5, 300] })).toBe(2);
      // The audit text says the length as the page does: 4 min 30 s.
      await save(asUser, uid, playerId, { difficulty: 'normal', setup: ['HecticAddCleave', 3, 270] });
      const label = await q(
        "select detail->>'summary' as s from public.audit_log where action = 'Sim Added' and target_id = $1 and detail->>'summary' like 'Normal%'",
        [playerId]
      );
      expect(label.rows[0].s).toBe(
        'Normal Frost sim from Raidbots (Hectic add cleave, 3 targets, 4 min 30 s), 2 results'
      );
      // Another difficulty has its own ten.
      expect(await save(asUser, uid, playerId, { difficulty: 'heroic', setup: ['Patchwerk', 11, 300] })).toBe(2);
      const audit = await q(
        `select detail->>'summary' as s from public.audit_log where action = 'Sim Added' and target_id = $1 order by id desc limit 1`,
        [playerId]
      );
      expect(audit.rows[0].s).toBe('Heroic Frost sim from Raidbots (Patchwerk, 11 targets, 5 min), 2 results');
    }));

  it('refuses a fight length out of bounds', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      await expect(save(asUser, team.raider.uid, playerId, { setup: ['Patchwerk', 1, 0] })).rejects.toThrow(
        /check constraint/i
      );
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // The fresh-agent review on PR #1920: the site admin path had no test.
  it('lets a site admin save and remove a raider’s sim', () =>
    withTxn(async ({ q, asUser }) => {
      const { playerId } = await raiderWithCharacter(q);
      expect(await save(asUser, SITE_ADMIN, playerId)).toBe(2);
      await remove(asUser, SITE_ADMIN, playerId);
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // Kat, 2026-11-25: the report's character must be this one, realm included,
  // compared as the page compares (case, spaces, underscores, apostrophes).
  it('refuses a report for another character, or with no realm', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const uid = team.raider.uid;
      for (const character of [
        ['Other', 'Illidan'],
        ['Simmer', 'Stormrage'],
        ['Simmer', ''],
        ['Simmer', null]
      ]) {
        await expect(save(asUser, uid, playerId, { character })).rejects.toThrow(/another character/i);
      }
      expect(await simsOf(q, playerId)).toEqual([]);
      expect(await save(asUser, uid, playerId, { character: ["SIM'MER", ' illi_dan '] })).toBe(2);
    }));

  // A realm with a dash or a space in it still matches.
  it('matches a realm with a dash or a space', () =>
    withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: 'Ash-Azjol-Nerub' });
      expect(await save(asUser, team.raider.uid, playerId, { character: ['Ash', 'azjol_nerub'] })).toBe(2);
      const wyrm = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: 'Wyrm-Wyrmrest Accord' });
      expect(await save(asUser, team.raider.uid, wyrm, { character: ['wyrm', 'wyrmrest_accord'] })).toBe(2);
    }));

  // CodeRabbit on PR #1920: with no roster spec there is no class to check,
  // so any class's sim would pass; it is refused until a spec is set.
  it('refuses a sim for a character with no roster spec', () =>
    withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, {
        memberId: team.raider.memberId,
        nameRealm: 'Nospec-Illidan',
        classSpecId: null
      });
      const havoc = await specId(q, 'Demon Hunter', 'Havoc');
      await expect(save(asUser, team.raider.uid, playerId, { spec: havoc })).rejects.toThrow(/spec on the roster/i);
      await expect(save(asUser, team.raider.uid, playerId)).rejects.toThrow(/spec on the roster/i);
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  it('lets an officer who manages loot save one for a raider, logged through write_audit_log()', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      expect(await save(asUser, team.officer.uid, playerId)).toBe(2);
      const audit = await q(`select actor_id from public.audit_log where action = 'Sim Added' and target_id = $1`, [
        playerId
      ]);
      expect(audit.rows).toEqual([{ actor_id: team.officer.uid }]);
    }));

  // CodeRabbit on PR #1914: an officer must not act on the team leader.
  it('refuses an officer on the team leader’s character, and lets the leader save their own', () =>
    withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const leaderPlayer = await seedPlayer(q, { memberId: team.leader.memberId, nameRealm: 'Leaderly-Illidan' });
      await expect(save(asUser, team.officer.uid, leaderPlayer)).rejects.toThrow(/not authorized/i);
      expect(await save(asUser, team.leader.uid, leaderPlayer, { character: ['Leaderly', 'Illidan'] })).toBe(2);
      await expect(remove(asUser, team.officer.uid, leaderPlayer)).rejects.toThrow(/not authorized/i);
      expect(await simsOf(q, leaderPlayer)).toHaveLength(1);
    }));

  it('refuses another raider on the team, an officer of another team, and a signed-out caller', () =>
    withTxn(async ({ q, asUser, asAnon }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const other = await seedTeam(q);
      const { uid: teammate } = await seedMember(q, { teamId: team.teamId });
      await expect(save(asUser, teammate, playerId)).rejects.toThrow(/not authorized/i);
      await expect(save(asUser, other.officer.uid, playerId)).rejects.toThrow(/not authorized/i);
      await expect(
        asAnon(
          "select public.save_character_sim($1, $2, 1, $3, $4, 'Simmer', 'Illidan', now(), null, null, null, $5::jsonb)",
          [playerId, 'mythic', 'raidbots', 'x', JSON.stringify([result()])]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  it('refuses a sim with no results, an unknown difficulty or source, and a bad report id', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const uid = team.raider.uid;
      await expect(save(asUser, uid, playerId, { results: [] })).rejects.toThrow(/no results/i);
      await expect(save(asUser, uid, playerId, { difficulty: 'mythic+' })).rejects.toThrow(/check constraint/i);
      await expect(save(asUser, uid, playerId, { source: 'wowhead' })).rejects.toThrow(/check constraint/i);
      await expect(save(asUser, uid, playerId, { reportId: 'a/b' })).rejects.toThrow(/check constraint/i);
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // The fresh-agent review on PR #1914: gains are bounded, which also turns
  // away NaN and infinity, since the Priority page sorts by them.
  it('refuses a gain that is not a number or out of bounds', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      for (const bad of [{ pct_gain: 'NaN' }, { pct_gain: 'Infinity' }, { pct_gain: 5000 }, { dps_gain: 1e12 }]) {
        await expect(save(asUser, team.raider.uid, playerId, { results: [result(bad)] })).rejects.toThrow(
          /check constraint/i
        );
      }
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // CodeRabbit on PR #1914: an officer's own sim is logged through write_audit_log() too.
  it('lets an officer save a sim on their own character', () =>
    withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const own = await seedPlayer(q, { memberId: team.officer.memberId, nameRealm: 'Officerly-Illidan' });
      expect(await save(asUser, team.officer.uid, own, { character: ['Officerly', 'Illidan'] })).toBe(2);
      const audit = await q(`select actor_id from public.audit_log where action = 'Sim Added' and target_id = $1`, [
        own
      ]);
      expect(audit.rows).toEqual([{ actor_id: team.officer.uid }]);
    }));

  // CodeRabbit on PR #1914: an officer whose rank edits the roster but doesn't
  // manage loot changes their own sim through write_audit_log(), which accepts
  // edit_roster, like any officer; one row each for the save and the removal.
  it('logs an officer without manage_loot changing their own sim, save and removal', () =>
    withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q(
        "delete from public.team_rank_permissions where team_id = $1 and rank = 'officer' and permission = 'manage_loot'",
        [team.teamId]
      );
      const own = await seedPlayer(q, { memberId: team.officer.memberId, nameRealm: 'Rosterly-Illidan' });
      const other = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: 'Notmine-Illidan' });
      // Without manage_loot the officer can't change a raider's sim.
      await expect(save(asUser, team.officer.uid, other)).rejects.toThrow(/not authorized/i);
      expect(await save(asUser, team.officer.uid, own, { character: ['Rosterly', 'Illidan'] })).toBe(2);
      await remove(asUser, team.officer.uid, own);
      const audit = await q(
        `select action, actor_id from public.audit_log where target_id = $1 and action like 'Sim %' order by id`,
        [own]
      );
      expect(audit.rows).toEqual([
        { action: 'Sim Added', actor_id: team.officer.uid },
        { action: 'Sim Removed', actor_id: team.officer.uid }
      ]);
    }));

  it('cannot be written directly, and anyone can read it', () =>
    withTxn(async ({ q, asUser, asAnon }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      await save(asUser, team.raider.uid, playerId);
      await expect(asUser(team.raider.uid, 'delete from public.character_sim_results')).rejects.toMatchObject({
        code: RLS_DENIED
      });
      await expect(asUser(team.officer.uid, "update public.character_sims set report_id = 'x'")).rejects.toMatchObject({
        code: RLS_DENIED
      });
      const read = await asAnon(
        'select count(*)::int as n from public.character_sim_results r join public.character_sims s on s.id = r.sim_id where s.player_id = $1',
        [playerId]
      );
      expect(read.rows[0].n).toBe(2);
    }));
});

describe('delete_character_sim()', () => {
  it('removes one difficulty’s sim for the raider or an officer, not another team’s officer, a teammate or a signed-out caller', () =>
    withTxn(async ({ q, asUser, asAnon }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      const other = await seedTeam(q);
      await save(asUser, team.raider.uid, playerId);
      await save(asUser, team.raider.uid, playerId, { difficulty: 'heroic' });
      const { uid: teammate } = await seedMember(q, { teamId: team.teamId });
      await expect(remove(asUser, other.officer.uid, playerId)).rejects.toThrow(/not authorized/i);
      await expect(remove(asUser, teammate, playerId)).rejects.toThrow(/not authorized/i);
      await expect(asAnon('select public.delete_character_sim(1)')).rejects.toMatchObject({
        code: RLS_DENIED
      });
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic', 'mythic']);
      await remove(asUser, team.raider.uid, playerId);
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic']);
      await remove(asUser, team.officer.uid, playerId, 'heroic');
      expect(await simsOf(q, playerId)).toEqual([]);
    }));

  // #1888: by its id, and a second click on an already-removed sim does nothing.
  it('removes one sim by its id, and does nothing for one already gone', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      await save(asUser, team.raider.uid, playerId);
      // Another setup's sim, same difficulty and spec, that must survive (CodeRabbit on PR #1921).
      await save(asUser, team.raider.uid, playerId, { reportId: 'aoe', setup: ['Patchwerk', 3, 300] });
      const id = (await q('select id from public.character_sims where player_id = $1 and target_count = 1', [playerId]))
        .rows[0].id;
      await asUser(team.raider.uid, 'select public.delete_character_sim($1)', [id]);
      await asUser(team.raider.uid, 'select public.delete_character_sim($1)', [id]);
      expect(await simsOf(q, playerId)).toEqual([
        { difficulty: 'mythic', spec: 1, source: 'raidbots', report_id: 'aoe', results: 2 }
      ]);
      const audit = await q(
        `select detail->>'summary' as s from public.audit_log where action = 'Sim Removed' and target_id = $1`,
        [playerId]
      );
      expect(audit.rows.map((r) => r.s)).toEqual(['Mythic Frost sim removed (Patchwerk, 1 target, 5 min)']);
    }));

  it('removes only the named spec’s sim (#1916)', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      await save(asUser, team.raider.uid, playerId);
      const fire = await specId(q, 'Mage', 'Fire');
      await save(asUser, team.raider.uid, playerId, { spec: fire });
      await remove(asUser, team.raider.uid, playerId, 'mythic', fire);
      expect((await simsOf(q, playerId)).map((s) => s.spec)).toEqual([1]);
    }));
});
