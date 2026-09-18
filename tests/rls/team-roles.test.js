// Behavior tests for admin_grant_team_role() / admin_revoke_team_role() and
// the guild_officers branch added to link_auth_user_to_member() (#910).
//
// The per-team tier is the only grant tier with no RPC: the three guild-wide
// grants (site admin, BoE manager, guild officer) each have an admin_{list,grant,revoke}_*
// trio, and team_members has none, so a team with no roster cannot be given
// an officer at all. These cover the grant's four branches, the gate, the
// revoke's demote-vs-delete split, and a person holding a role on two teams,
// which nothing has ever exercised because no Discord id is on two teams in
// production or in the seed.
//
// Each test runs in one rolled-back transaction: fixture writes happen as
// postgres (bypasses RLS), the call happens as the named identity, assertions
// happen back as postgres.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn as withSharedTxn,
  insertDiscordUser,
  grantGuild,
  OFFICER_T1,
  TEAM_LEADER_T1,
  SITE_ADMIN
} from './helpers.js';

// Seeded and migration-created rows this file leans on:
//   team 1 'Team Phoenix', team 2 'Hellfire Rollers' (supabase/seed.sql)
//   team 4 'Wrathless' (20260826220829), seeded with an officer, a team leader,
//   a raider and one player since #1065
//   player 1 'Seedraider-Illidan' on team 1, team_member_id null
const TEAM_1 = 1;
const TEAM_2 = 2;
const WRATHLESS = 4;

// Discord ids and auth uuids invented here. None collide with the seed, so
// the link trigger cannot fire for them at seed time.
const NO_ACCOUNT = 'discord-no-account-1';
const HAS_ACCOUNT = 'discord-has-account-1';
const HAS_ACCOUNT_UID = '00000000-0000-0000-0000-0000000000a1';
const TWO_TEAM = 'discord-two-team-1';
const TWO_TEAM_UID = '00000000-0000-0000-0000-0000000000a2';
const NEW_GUILD_OFFICER = 'discord-new-guild-officer-1';
const NEW_GUILD_OFFICER_UID = '00000000-0000-0000-0000-0000000000a3';
const STRANGER = 'discord-stranger-1';
const STRANGER_UID = '00000000-0000-0000-0000-0000000000a4';
const NEW_BOE_MANAGER = 'discord-new-boe-manager-1';
const NEW_BOE_MANAGER_UID = '00000000-0000-0000-0000-0000000000a5';

// Wraps the shared harness: asUser runs one statement as `uid` (null means
// anon), then restores postgres. Half this file asserts a raise, so the
// savepoint per call is load-bearing, not defensive.
async function withTxn(fn) {
  return withSharedTxn(({ q, asUser, asAnon }) =>
    fn(q, (uid, text, params) => (uid ? asUser(uid, text, params) : asAnon(text, params)))
  );
}

const grant = (asUser, uid, teamId, discordId, role) =>
  asUser(uid, 'select public.admin_grant_team_role($1, $2, $3) as auth_user_id', [teamId, discordId, role]);

const revoke = (asUser, uid, teamId, discordId) =>
  asUser(uid, 'select public.admin_revoke_team_role($1, $2)', [teamId, discordId]);

// An account and the Discord identity behind it. Since #1135 the identity row
// is what the link trigger fires on and what the grant RPCs resolve through, so
// an auth.users row on its own would link nothing.
const makeAuthUser = (q, uid, discordId) => insertDiscordUser(q, uid, discordId);

const memberRow = (q, teamId, discordId) =>
  q('select * from public.team_members where team_id = $1 and discord_id = $2', [teamId, discordId]).then(
    (r) => r.rows[0]
  );

const newMember = (q, teamId, discordId, role) =>
  q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3) returning id', [
    teamId,
    discordId,
    role
  ]).then((r) => r.rows[0].id);

const lastLog = (q) => q('select * from public.audit_log order by id desc limit 1').then((r) => r.rows[0]);

afterAll(async () => {
  await pool.end();
});

describe('admin_grant_team_role() opens a team that has no roster', () => {
  it('a site admin grants a role on a team with no members or players', async () => {
    await withTxn(async (q, asUser) => {
      const res = await grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'officer');
      expect(res.rows[0].auth_user_id).toBeNull();

      const row = await memberRow(q, WRATHLESS, NO_ACCOUNT);
      expect(row.role).toBe('officer');
      expect(row.auth_user_id).toBeNull();
      expect(row.name_realm).toBeNull();
    });
  });

  it('resolves auth_user_id from the Discord id at grant time', async () => {
    await withTxn(async (q, asUser) => {
      await makeAuthUser(q, HAS_ACCOUNT_UID, HAS_ACCOUNT);

      const res = await grant(asUser, SITE_ADMIN, WRATHLESS, HAS_ACCOUNT, 'team_leader');
      expect(res.rows[0].auth_user_id).toBe(HAS_ACCOUNT_UID);

      const row = await memberRow(q, WRATHLESS, HAS_ACCOUNT);
      expect(row.auth_user_id).toBe(HAS_ACCOUNT_UID);
      expect(row.role).toBe('team_leader');
    });
  });

  it('writes an audit entry naming the granting site admin', async () => {
    await withTxn(async (q, asUser) => {
      await grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'officer');

      const log = await lastLog(q);
      expect(log.action).toBe('team_role_granted');
      expect(log.team_id).toBe(WRATHLESS);
      expect(log.actor_id).toBe(SITE_ADMIN);
      expect(log.detail.discord_id).toBe(NO_ACCOUNT);
      expect(log.detail.role).toBe('officer');
    });
  });
});

describe('admin_grant_team_role() and an existing row', () => {
  // Until #942 step 3 this was a repair: a row inserted by hand for somebody
  // who had already signed in kept a null auth_user_id, and a re-grant filled
  // it in. The account now comes from the person on every write, so that row
  // is linked the moment it is written and there is nothing left to repair.
  it('links a row written by hand for someone who already signed in, so a re-grant is refused', async () => {
    await withTxn(async (q, asUser) => {
      await makeAuthUser(q, HAS_ACCOUNT_UID, HAS_ACCOUNT);
      await newMember(q, WRATHLESS, HAS_ACCOUNT, 'officer');
      expect((await memberRow(q, WRATHLESS, HAS_ACCOUNT)).auth_user_id).toBe(HAS_ACCOUNT_UID);

      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, HAS_ACCOUNT, 'officer')).rejects.toThrow(
        /already has the officer role on this team\.$/i
      );
    });
  });

  it('refuses to change a role that is already set, and leaves the row alone', async () => {
    await withTxn(async (q, asUser) => {
      await newMember(q, WRATHLESS, NO_ACCOUNT, 'raider');

      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'team_leader')).rejects.toThrow(
        /already has the raider role/i
      );
      expect((await memberRow(q, WRATHLESS, NO_ACCOUNT)).role).toBe('raider');
    });
  });

  it('refuses a re-grant of the same role on a row that is already linked', async () => {
    await withTxn(async (q, asUser) => {
      await makeAuthUser(q, HAS_ACCOUNT_UID, HAS_ACCOUNT);
      await q('insert into public.team_members (team_id, discord_id, auth_user_id, role) values ($1, $2, $3, $4)', [
        WRATHLESS,
        HAS_ACCOUNT,
        HAS_ACCOUNT_UID,
        'officer'
      ]);

      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, HAS_ACCOUNT, 'officer')).rejects.toThrow(
        /already has the officer role/i
      );
    });
  });

  it('refuses a re-grant when the row is unlinked and there is still no account', async () => {
    // Nothing to repair: saying so beats returning a null that reads the same
    // as a fresh grant that did not resolve.
    await withTxn(async (q, asUser) => {
      await newMember(q, WRATHLESS, NO_ACCOUNT, 'officer');

      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'officer')).rejects.toThrow(
        /no account exists for it/i
      );
    });
  });

  it('rejects a role outside the CHECK', async () => {
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'admin')).rejects.toThrow(/must be one of/i);
    });
  });
});

describe('admin_grant_team_role() authorization', () => {
  it('a team leader grants on their own team', async () => {
    await withTxn(async (q, asUser) => {
      await grant(asUser, TEAM_LEADER_T1, TEAM_1, NO_ACCOUNT, 'officer');
      expect((await memberRow(q, TEAM_1, NO_ACCOUNT)).role).toBe('officer');
    });
  });

  it('a team leader cannot grant on a team they do not lead', async () => {
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, TEAM_LEADER_T1, TEAM_2, NO_ACCOUNT, 'officer')).rejects.toThrow(/not authorized/i);
    });
  });

  it('nobody but a site admin can bootstrap a rosterless team', async () => {
    // The caller holds no row on team 4, so my_team_role(4) is null for them.
    // The gate coalesces that null to false (#752); before it did, the null
    // let the call through and only write_audit_log() turned it away.
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, TEAM_LEADER_T1, WRATHLESS, NO_ACCOUNT, 'officer')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an officer cannot grant', async () => {
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, OFFICER_T1, TEAM_1, NO_ACCOUNT, 'officer')).rejects.toThrow(/not authorized/i);
    });
  });

  // Written red against #752. my_team_role() is null for a caller with no row
  // on the team, the bare comparison made the gate null, and the raise never
  // fired. write_audit_log() carries the coalesced gate and used to catch a
  // grant to somebody else, which is why the cases above stayed green; a
  // grant to oneself, or a call from a tier that passes the audit log's own
  // gate, went through. Each caller is built here so a later seed edit
  // cannot hand it a row and turn a refusal into a wrong-reason pass.
  it('an account with no role anywhere cannot grant itself team leader', async () => {
    await withTxn(async (q, asUser) => {
      await makeAuthUser(q, STRANGER_UID, STRANGER);
      await expect(grant(asUser, STRANGER_UID, TEAM_2, STRANGER, 'team_leader')).rejects.toThrow(/not authorized/i);
      expect(await memberRow(q, TEAM_2, STRANGER)).toBeUndefined();
    });
  });

  it('a BoE manager with no row on the team cannot grant', async () => {
    await withTxn(async (q, asUser) => {
      await grantGuild(q, NEW_BOE_MANAGER, 'boe_manager');
      await makeAuthUser(q, NEW_BOE_MANAGER_UID, NEW_BOE_MANAGER);
      await expect(grant(asUser, NEW_BOE_MANAGER_UID, TEAM_2, NO_ACCOUNT, 'officer')).rejects.toThrow(
        /not authorized/i
      );
    });
  });

  it('a guild officer with no row on the team cannot revoke', async () => {
    await withTxn(async (q, asUser) => {
      await grantGuild(q, STRANGER, 'guild_officer');
      await newMember(q, TEAM_1, STRANGER, 'raider');
      await makeAuthUser(q, STRANGER_UID, STRANGER);
      await expect(revoke(asUser, STRANGER_UID, TEAM_2, 'discord-officer-2')).rejects.toThrow(/not authorized/i);
      expect((await memberRow(q, TEAM_2, 'discord-officer-2')).role).toBe('officer');
    });
  });

  it('anon cannot reach the function at all', async () => {
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, null, TEAM_1, NO_ACCOUNT, 'officer')).rejects.toThrow(/permission denied/i);
    });
  });

  it('refuses a team that does not exist', async () => {
    await withTxn(async (q, asUser) => {
      await expect(grant(asUser, SITE_ADMIN, 9999, NO_ACCOUNT, 'officer')).rejects.toThrow(/no team with id/i);
    });
  });

  it('refuses an archived team', async () => {
    await withTxn(async (q, asUser) => {
      await q('update public.teams set archived_at = now() where id = $1', [WRATHLESS]);
      await expect(grant(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT, 'officer')).rejects.toThrow(/archived/i);
    });
  });
});

describe('one person holding a role on two teams', () => {
  it('reads back per team through my_team_role and can_settle_boe', async () => {
    await withTxn(async (q, asUser) => {
      await makeAuthUser(q, TWO_TEAM_UID, TWO_TEAM);
      await grant(asUser, SITE_ADMIN, TEAM_2, TWO_TEAM, 'officer');
      await grant(asUser, SITE_ADMIN, WRATHLESS, TWO_TEAM, 'team_leader');

      const roles = await asUser(
        TWO_TEAM_UID,
        'select public.my_team_role($1) as t2, public.my_team_role($2) as t4, public.can_settle_boe($1) as s2, public.can_settle_boe($2) as s4',
        [TEAM_2, WRATHLESS]
      );
      expect(roles.rows[0].t2).toBe('officer');
      expect(roles.rows[0].t4).toBe('team_leader');
      expect(roles.rows[0].s2).toBe(true);
      expect(roles.rows[0].s4).toBe(true);
    });
  });
});

describe('admin_revoke_team_role() never unclaims a character', () => {
  it('demotes to raider when a player row points at the member', async () => {
    // players_team_member_id_fkey is ON DELETE SET NULL, so deleting the
    // member would silently unclaim the character with no error anywhere.
    await withTxn(async (q, asUser) => {
      const memberId = await newMember(q, TEAM_1, NO_ACCOUNT, 'officer');
      await q('update public.players set team_member_id = $1 where id = 1', [memberId]);

      await revoke(asUser, SITE_ADMIN, TEAM_1, NO_ACCOUNT);

      expect((await memberRow(q, TEAM_1, NO_ACCOUNT)).role).toBe('raider');
      const player = (await q('select team_member_id from public.players where id = 1')).rows[0];
      expect(player.team_member_id).toBe(memberId);
    });
  });

  it('deletes a member no character points at', async () => {
    await withTxn(async (q, asUser) => {
      await newMember(q, WRATHLESS, NO_ACCOUNT, 'officer');

      await revoke(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT);
      expect(await memberRow(q, WRATHLESS, NO_ACCOUNT)).toBeUndefined();
    });
  });

  it('logs a demote and a delete under different actions', async () => {
    await withTxn(async (q, asUser) => {
      const memberId = await newMember(q, TEAM_1, NO_ACCOUNT, 'officer');
      await q('update public.players set team_member_id = $1 where id = 1', [memberId]);
      await revoke(asUser, SITE_ADMIN, TEAM_1, NO_ACCOUNT);
      const demote = await lastLog(q);

      await newMember(q, WRATHLESS, NO_ACCOUNT, 'officer');
      await revoke(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT);
      const del = await lastLog(q);

      expect(demote.action).toBe('team_role_demoted');
      expect(del.action).toBe('team_role_revoked');
    });
  });

  it('raises when the person holds no role on that team', async () => {
    await withTxn(async (q, asUser) => {
      await expect(revoke(asUser, SITE_ADMIN, WRATHLESS, NO_ACCOUNT)).rejects.toThrow(/does not have/i);
    });
  });
});

describe('link_auth_user_to_member() covers guild_officers', () => {
  it('links a guild officer granted before they had signed in', async () => {
    await withTxn(async (q) => {
      await grantGuild(q, NEW_GUILD_OFFICER, 'guild_officer');
      await makeAuthUser(q, NEW_GUILD_OFFICER_UID, NEW_GUILD_OFFICER);

      const row = (await q('select auth_user_id from public.guild_officers where discord_id = $1', [NEW_GUILD_OFFICER]))
        .rows[0];
      expect(row.auth_user_id).toBe(NEW_GUILD_OFFICER_UID);
    });
  });

  // Green on both sides on purpose: the regression guard that adding the
  // fourth branch did not disturb the three that already worked.
  it('still links the other three tables', async () => {
    await withTxn(async (q) => {
      await newMember(q, WRATHLESS, NEW_GUILD_OFFICER, 'officer');
      await grantGuild(q, NEW_GUILD_OFFICER, 'boe_manager');
      await makeAuthUser(q, NEW_GUILD_OFFICER_UID, NEW_GUILD_OFFICER);

      expect((await memberRow(q, WRATHLESS, NEW_GUILD_OFFICER)).auth_user_id).toBe(NEW_GUILD_OFFICER_UID);
      const mgr = (await q('select auth_user_id from public.boe_managers where discord_id = $1', [NEW_GUILD_OFFICER]))
        .rows[0];
      expect(mgr.auth_user_id).toBe(NEW_GUILD_OFFICER_UID);
    });
  });
});
