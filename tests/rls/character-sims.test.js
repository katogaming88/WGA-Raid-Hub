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
  { difficulty = 'mythic', source = 'raidbots', reportId = 'abc123', results } = {}
) =>
  asUser(uid, 'select public.save_character_sim($1, $2, $3, $4, now(), $5, $6, $7::jsonb) as n', [
    playerId,
    difficulty,
    source,
    reportId,
    'Patchwerk',
    1,
    JSON.stringify(results ?? [result(), result({ slot: 'finger2', pct_gain: 1.9 })])
  ]).then((r) => r.rows[0].n);

const remove = (asUser, uid, playerId, difficulty = 'mythic') =>
  asUser(uid, 'select public.delete_character_sim($1, $2)', [playerId, difficulty]);

async function raiderWithCharacter(q) {
  const team = await seedTeam(q);
  const playerId = await seedPlayer(q, {
    teamId: team.teamId,
    memberId: team.raider.memberId,
    nameRealm: 'Simmer-Illidan'
  });
  return { team, playerId };
}

const simsOf = async (q, playerId) =>
  (
    await q(
      `select s.difficulty, s.source, s.report_id, count(r.id)::int as results
         from public.character_sims s left join public.character_sim_results r on r.sim_id = s.id
        where s.player_id = $1 group by s.id order by s.difficulty`,
      [playerId]
    )
  ).rows;

describe('save_character_sim()', () => {
  it('saves the raider’s own sim with every result, and logs it', () =>
    withTxn(async ({ q, asUser }) => {
      const { team, playerId } = await raiderWithCharacter(q);
      expect(await save(asUser, team.raider.uid, playerId)).toBe(2);
      expect(await simsOf(q, playerId)).toEqual([
        { difficulty: 'mythic', source: 'raidbots', report_id: 'abc123', results: 2 }
      ]);
      const audit = await q(`select 1 from public.audit_log where action = 'Sim Added' and target_id = $1`, [playerId]);
      expect(audit.rowCount).toBe(1);
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
        { difficulty: 'heroic', source: 'raidbots', report_id: 'hero', results: 2 },
        { difficulty: 'mythic', source: 'qe_live', report_id: 'second', results: 1 }
      ]);
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
        asAnon('select public.save_character_sim($1, $2, $3, $4, now(), null, null, $5::jsonb)', [
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
      await expect(asAnon('select public.delete_character_sim($1, $2)', [playerId, 'mythic'])).rejects.toMatchObject({
        code: RLS_DENIED
      });
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic', 'mythic']);
      await remove(asUser, team.raider.uid, playerId);
      expect((await simsOf(q, playerId)).map((s) => s.difficulty)).toEqual(['heroic']);
      await remove(asUser, team.officer.uid, playerId, 'heroic');
      expect(await simsOf(q, playerId)).toEqual([]);
    }));
});
