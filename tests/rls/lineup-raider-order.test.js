// set_lineup_raider_order() and team_raider_order (#1683): the order a team
// lists its raiders in within a role section of Boss Lineup, a standing
// setting gated the way lineup writes are.
import { describe, it, expect } from 'vitest';
import {
  withTxn,
  seedPlayer,
  RAIDER_T1,
  OFFICER_T1,
  TEAM_LEADER_T1,
  OFFICER_T2,
  GUILD_OFFICER,
  SITE_ADMIN
} from './helpers.js';

async function seed(q) {
  // The seed has one spec, a Ranged Frost Mage.
  const ranged = 1;
  const melee = (
    await q("insert into public.classes_specs (class, spec, role) values ('Rogue', 'Outlaw', 'Melee') returning id")
  ).rows[0].id;
  const a = await seedPlayer(q, { teamId: 1, classSpecId: ranged });
  const b = await seedPlayer(q, { teamId: 1, classSpecId: ranged });
  const c = await seedPlayer(q, { teamId: 1, classSpecId: ranged });
  const m = await seedPlayer(q, { teamId: 1, classSpecId: melee });
  const other = await seedPlayer(q, { teamId: 2, classSpecId: ranged });
  return { a, b, c, m, other };
}

const setOrder = (asUser, uid, role, ids, team = 1) =>
  asUser(uid, 'select public.set_lineup_raider_order($1, $2, $3)', [team, role, ids]);

const orderOf = async (q, team = 1) =>
  (
    await q('select player_id, position from public.team_raider_order where team_id = $1 order by position', [team])
  ).rows.map((r) => [r.player_id, r.position]);

describe('set_lineup_raider_order()', () => {
  it('keeps the role a raider was placed in: a raider who changes role leaves a row the next save of either section clears', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, b, m } = await seed(q);
      await setOrder(asUser, OFFICER_T1, 'Ranged', [a, b]);
      const roles = async () =>
        (await q('select player_id, role from public.team_raider_order order by position')).rows.map((r) => [
          r.player_id,
          r.role
        ]);
      expect((await roles()).sort()).toEqual(
        [
          [a, 'Ranged'],
          [b, 'Ranged']
        ].sort()
      );
      // a moves to Melee: the page ignores a's Ranged row; ordering Melee replaces it.
      const melee = (await q('select class_spec_id from public.players where id = $1', [m])).rows[0].class_spec_id;
      await q('update public.players set class_spec_id = $1 where id = $2', [melee, a]);
      await setOrder(asUser, OFFICER_T1, 'Melee', [m, a]);
      expect((await roles()).sort()).toEqual(
        [
          [b, 'Ranged'],
          [m, 'Melee'],
          [a, 'Melee']
        ].sort()
      );
      // Ordering Ranged clears nothing of Melee's.
      await setOrder(asUser, OFFICER_T1, 'Ranged', []);
      expect((await roles()).sort()).toEqual(
        [
          [m, 'Melee'],
          [a, 'Melee']
        ].sort()
      );
    });
  });

  it('refuses an archived raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, b } = await seed(q);
      await q('update public.players set archived_at = now() where id = $1', [b]);
      await expect(setOrder(asUser, OFFICER_T1, 'Ranged', [a, b])).rejects.toThrow(/on the roster/);
      expect(await orderOf(q)).toEqual([]);
    });
  });

  it('writes the role and the raiders, in order, to the audit log', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, b } = await seed(q);
      await setOrder(asUser, OFFICER_T1, 'Ranged', [b, a]);
      const names = (
        await q('select name_realm from public.players where id = any($1) order by array_position($1::int[], id)', [
          [b, a]
        ])
      ).rows.map((r) => r.name_realm);
      const detail = (await q("select detail from public.audit_log where action = 'Set Raider Order'")).rows[0].detail;
      expect(detail).toEqual({ role: 'Ranged', raiders: names });
    });
  });

  it('lets the team officer, team leader and a site admin place a section, and an empty list puts it back to A-Z', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, b, c } = await seed(q);
      await setOrder(asUser, OFFICER_T1, 'Ranged', [c, a, b]);
      expect(await orderOf(q)).toEqual([
        [c, 1],
        [a, 2],
        [b, 3]
      ]);
      await setOrder(asUser, TEAM_LEADER_T1, 'Ranged', [b, c]);
      expect(await orderOf(q)).toEqual([
        [b, 1],
        [c, 2]
      ]);
      await setOrder(asUser, SITE_ADMIN, 'Ranged', []);
      expect(await orderOf(q)).toEqual([]);
      const audit = (await q("select action from public.audit_log where action like '%Raider Order' order by id")).rows;
      expect(audit.map((r) => r.action)).toEqual(['Set Raider Order', 'Set Raider Order', 'Reset Raider Order']);
    });
  });

  it("keeps another role's order when a section is set or reset", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, b, m } = await seed(q);
      await setOrder(asUser, OFFICER_T1, 'Melee', [m]);
      await setOrder(asUser, OFFICER_T1, 'Ranged', [b, a]);
      await setOrder(asUser, OFFICER_T1, 'Ranged', []);
      expect(await orderOf(q)).toEqual([[m, 1]]);
    });
  });

  it('refuses a raider twice, another team or role, and a role that does not exist', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { a, m, other } = await seed(q);
      await expect(setOrder(asUser, OFFICER_T1, 'Ranged', [a, a])).rejects.toThrow(/only once/);
      await expect(setOrder(asUser, OFFICER_T1, 'Ranged', [a, other])).rejects.toThrow(
        /on this team, on the roster and in the/
      );
      await expect(setOrder(asUser, OFFICER_T1, 'Ranged', [a, m])).rejects.toThrow(
        /on this team, on the roster and in the/
      );
      await expect(setOrder(asUser, OFFICER_T1, 'Bard', [a])).rejects.toThrow(/no such role/);
      await expect(setOrder(asUser, SITE_ADMIN, 'Ranged', [a], 999999)).rejects.toThrow(/no such team/);
      expect(await orderOf(q)).toEqual([]);
    });
  });

  it("is refused to a raider, another team's officer, a guild officer and a signed-out caller, setting or resetting", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { a, b } = await seed(q);
      for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
        await expect(setOrder(asUser, uid, 'Ranged', [a])).rejects.toThrow(/Not authorized/);
      }
      await expect(asAnon('select public.set_lineup_raider_order(1, $1, $2)', ['Ranged', [a]])).rejects.toThrow(
        /permission denied/
      );
      await setOrder(asUser, OFFICER_T1, 'Ranged', [b, a]);
      for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER]) {
        await expect(setOrder(asUser, uid, 'Ranged', [])).rejects.toThrow(/Not authorized/);
      }
      expect(await orderOf(q)).toEqual([
        [b, 1],
        [a, 2]
      ]);
    });
  });

  it("is read by the team's raiders and officers, not another team's or a signed-out caller, and never written directly", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { a } = await seed(q);
      // RAIDER_T1 reads as a raider with a character on the team.
      await seedPlayer(q, { memberId: 3 });
      await setOrder(asUser, OFFICER_T1, 'Ranged', [a]);
      const read = 'select player_id from public.team_raider_order where team_id = 1';
      expect((await asUser(RAIDER_T1, read)).rows).toEqual([{ player_id: a }]);
      expect((await asUser(OFFICER_T1, read)).rows).toEqual([{ player_id: a }]);
      expect((await asUser(OFFICER_T2, read)).rows).toEqual([]);
      expect((await asAnon(read)).rows).toEqual([]);
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.team_raider_order (team_id, player_id, role, position) values (1, $1, 'Ranged', 9)",
          [a]
        )
      ).rejects.toThrow(/permission denied/);
    });
  });
});
