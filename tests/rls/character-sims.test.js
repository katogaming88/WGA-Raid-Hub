// save_character_sim() and delete_character_sim() (#1443): a raider, or an
// officer who manages the team's loot, saves a droptimizer sim; one per
// character per difficulty, a new one replacing the old. Anyone reads them.
// Each case mints its own team; everything is rolled back.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, seedMember, RLS_DENIED } from './helpers.js';

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
  { difficulty = 'mythic', spec = 1, source = 'raidbots', reportId = 'abc123', results } = {}
) =>
  asUser(uid, 'select public.save_character_sim($1, $2, $3, $4, $5, now(), $6, $7, $8::jsonb) as n', [
    playerId,
    difficulty,
    spec,
    source,
    reportId,
    'Patchwerk',
    1,
    JSON.stringify(results ?? [result(), result({ slot: 'finger2', pct_gain: 1.9 })])
  ]).then((r) => r.rows[0].n);

const remove = (asUser, uid, playerId, difficulty = 'mythic', spec = 1) =>
  asUser(uid, 'select public.delete_character_sim($1, $2, $3)', [playerId, difficulty, spec]);

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
        'Mythic Frost sim from Raidbots, 2 results',
        'Mythic Fire sim from Raidbots, 2 results',
        'Mythic Fire sim from Raidbots, 1 results'
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
      expect(await save(asUser, team.leader.uid, leaderPlayer)).toBe(2);
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
        asAnon('select public.save_character_sim($1, $2, 1, $3, $4, now(), null, null, $5::jsonb)', [
          playerId,
          'mythic',
          'raidbots',
          'x',
          JSON.stringify([result()])
        ])
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
      expect(await save(asUser, team.officer.uid, own)).toBe(2);
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
      expect(await save(asUser, team.officer.uid, own)).toBe(2);
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
      await expect(asAnon('select public.delete_character_sim($1, $2, 1)', [playerId, 'mythic'])).rejects.toMatchObject(
        {
          code: RLS_DENIED
        }
      );
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic', 'mythic']);
      await remove(asUser, team.raider.uid, playerId);
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic']);
      await remove(asUser, team.officer.uid, playerId, 'heroic');
      expect(await simsOf(q, playerId)).toEqual([]);
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
