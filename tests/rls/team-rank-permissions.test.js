// #1653: the team's rank permissions grid. On Phoenix (team 1) the seed makes
// TEAM_LEADER_T1 the Team Owner, OFFICER_T1 an Officer and RAIDER_T1 a Raider.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedMember,
  seedPlayer,
  GUILD_OFFICER,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  SITE_ADMIN,
  TEAM_LEADER_T1,
  TEAM_LEADER_T2,
  TEAM_LEADER_T3
} from './helpers.js';

afterAll(() => pool.end());

const T1 = 1;
const RAIDER_T1_MEMBER = 3;

const change = (rank, permission, on) => ({ rank, permission, on });
const save = (asUser, uid, changes, team = T1) =>
  asUser(uid, 'select public.set_team_rank_permissions($1, $2::jsonb)', [team, JSON.stringify(changes)]);
const has = async (asUser, uid, permission) =>
  (await asUser(uid, 'select public.has_team_permission($1, $2) as ok', [T1, permission])).rows[0].ok;
const audits = (q) =>
  q(`select detail from public.audit_log where action = 'Team Permissions Changed' and team_id = $1 order by id`, [T1]);

describe('set_team_rank_permissions', () => {
  it('a saved switch changes what that rank can do at once, both ways, and is audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await has(asUser, OFFICER_T1, 'edit_roster')).toBe(true);
      await save(asUser, TEAM_LEADER_T1, [change('officer', 'edit_roster', false)]);
      expect(await has(asUser, OFFICER_T1, 'edit_roster')).toBe(false);

      expect(await has(asUser, RAIDER_T1, 'view_reports')).toBe(false);
      await save(asUser, TEAM_LEADER_T1, [change('raider', 'view_reports', true)]);
      expect(await has(asUser, RAIDER_T1, 'view_reports')).toBe(true);

      const { rows } = await audits(q);
      expect(rows.map((r) => r.detail)).toEqual([{ 'officer edit_roster': false }, { 'raider view_reports': true }]);
    });
  });

  it('a save that changes nothing logs nothing, and a permission it does not name stays as it is', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, TEAM_LEADER_T1, [
        change('officer', 'edit_roster', true),
        change('raider', 'edit_roster', false)
      ]);
      await save(asUser, TEAM_LEADER_T1, []);
      expect((await audits(q)).rows).toEqual([]);
      expect(await has(asUser, OFFICER_T1, 'manage_loot')).toBe(true);
    });
  });

  it('applies all of a save or none of it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('savepoint before_save');
      await expect(
        save(asUser, TEAM_LEADER_T1, [
          change('officer', 'edit_roster', false),
          change('officer', 'no_such_permission', true)
        ])
      ).rejects.toThrow('That is not a team permission');
      await q('rollback to savepoint before_save');
      expect(await has(asUser, OFFICER_T1, 'edit_roster')).toBe(true);
    });
  });

  it('refuses a guild permission, a rank that is not on the grid, and a change with no on or off', async () => {
    await withTxn(async ({ q, asUser }) => {
      for (const [changes, message] of [
        [[change('officer', 'create_teams', true)], 'That is not a team permission'],
        [[change('owner', 'edit_roster', false)], 'A rank is Officer, Assistant or Raider'],
        [[{ rank: 'officer', permission: 'edit_roster' }], 'A change must say on or off'],
        [{ rank: 'officer' }, 'Changes must be a list']
      ]) {
        await q('savepoint s');
        await expect(save(asUser, TEAM_LEADER_T1, changes)).rejects.toThrow(message);
        await q('rollback to savepoint s');
      }
    });
  });

  it('only the Team Owner saves: not an Officer, a Raider, a guild Owner or Admin, another team, or Staff', async () => {
    await withTxn(async ({ q, asUser }) => {
      for (const uid of [
        OFFICER_T1,
        RAIDER_T1,
        TEAM_LEADER_T3,
        GUILD_OFFICER,
        OFFICER_T2,
        TEAM_LEADER_T2,
        SITE_ADMIN
      ]) {
        await q('savepoint s');
        await expect(save(asUser, uid, [change('officer', 'edit_roster', false)])).rejects.toThrow('Not authorized');
        await q('rollback to savepoint s');
      }
      await q('savepoint s');
      await expect(save(asUser, null, [change('officer', 'edit_roster', false)])).rejects.toThrow('Not signed in');
      await q('rollback to savepoint s');
      expect(await has(asUser, OFFICER_T1, 'edit_roster')).toBe(true);
    });
  });

  it('refuses an archived team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.teams set archived_at = now() where id = $1', [T1]);
      await expect(save(asUser, TEAM_LEADER_T1, [change('officer', 'edit_roster', false)])).rejects.toThrow(
        'That team is archived'
      );
    });
  });
});

describe('set_team_rank_permissions audit', () => {
  it('a switch sent off then on ends where it began, so it is not logged as a change', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, TEAM_LEADER_T1, [
        change('officer', 'edit_roster', false),
        change('officer', 'edit_roster', true),
        change('officer', 'manage_loot', false)
      ]);
      expect((await audits(q)).rows.map((x) => x.detail)).toEqual([{ 'officer manage_loot': false }]);
    });
  });
});

describe('Edit own wishlist, switched off (#1653)', () => {
  const pick = (asUser, uid, pid) =>
    asUser(uid, "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')", [
      pid
    ]);

  it('a Raider cannot write their own wishlist, even with the character override on, until it is back on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await seedPlayer(q, { memberId: RAIDER_T1_MEMBER });
      await q('update public.players set wishlist_allowed = true where id = $1', [pid]);
      await pick(asUser, RAIDER_T1, pid);

      await save(asUser, TEAM_LEADER_T1, [change('raider', 'edit_own_wishlist', false)]);
      await q('savepoint s');
      await expect(pick(asUser, RAIDER_T1, pid)).rejects.toThrow('your rank cannot edit its wishlist');
      await q('rollback to savepoint s');
      await expect(
        asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where player_id = $1", [pid])
      ).rejects.toThrow('your rank cannot edit its wishlist');

      await save(asUser, TEAM_LEADER_T1, [change('raider', 'edit_own_wishlist', true)]);
      await asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where player_id = $1", [pid]);
    });
  });

  it('a Raider cannot write a signup wishlist either, until it is back on', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("update public.seasons set ends_at = '2098-12-31' where ends_at is null and starts_at is not null");
      await q(
        "insert into public.seasons (code, display_name, starts_at, ends_at) values ('lock-season', 'lock-season', '2099-01-01', '2099-03-01')"
      );
      await q(
        "insert into public.team_seasons (team_id, season_code, signups_open, wishlist_open) values (1, 'lock-season', true, true)"
      );
      const me = await seedMember(q);
      const { rows } = await q(
        `insert into public.season_signups (team_id, season, person_id, auth_user_id, signup_name_realm, class_spec_id, status)
         values (1, 'lock-season', (select person_id from public.team_members where id = $1), $2, 'Lockmain-Illidan', 1, 'pending') returning id`,
        [me.memberId, me.uid]
      );
      const mark = () =>
        asUser(
          me.uid,
          "insert into public.signup_item_preferences (signup_id, item_id, status, slot) values ($1, (select id from public.items limit 1), 'bis', 'Head')",
          [rows[0].id]
        );

      await save(asUser, TEAM_LEADER_T1, [change('raider', 'edit_own_wishlist', false)]);
      await q('savepoint s');
      await expect(mark()).rejects.toThrow('your rank cannot edit its wishlist');
      await q('rollback to savepoint s');
      await save(asUser, TEAM_LEADER_T1, [change('raider', 'edit_own_wishlist', true)]);
      await mark();
    });
  });

  it('an Officer keeps their own wishlist while only Raiders are locked', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await seedPlayer(q, { memberId: 1 });
      await q('update public.players set wishlist_allowed = true where id = $1', [pid]);
      await save(asUser, TEAM_LEADER_T1, [change('raider', 'edit_own_wishlist', false)]);
      await pick(asUser, OFFICER_T1, pid);
    });
  });
});
