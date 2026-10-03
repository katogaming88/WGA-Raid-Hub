// Behavior tests for restore_team_member() and the signup add that calls it
// (#1402). Any officer action brings an archived member back, as a raider,
// and nothing self-service does (Option 2 on #1355). Lives in the RLS suite
// because the function is SECURITY DEFINER and the add is RLS-driven.
//
// Each case mints its own team and archives people through
// archive_team_member(), the only way a membership is archived.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  insertDiscordUser,
  grantGuild,
  seedTeam,
  seedMember,
  seedPlayer,
  seedSignup
} from './helpers.js';

afterAll(() => pool.end());

const archiveMember = (asUser, uid, teamId, memberId) =>
  asUser(uid, 'select public.archive_team_member($1, $2, $3, $4)', [teamId, memberId, 'moved_guilds', 'Left']);

const restoreMember = (asUser, uid, teamId, memberId) =>
  asUser(uid, 'select public.restore_team_member($1, $2)', [teamId, memberId]);

// Someone with a guild-wide grant and no membership on the team.
const seedGrant = async (q, grantType) => {
  const uid = randomUUID();
  const discordId = `fixture-${randomUUID()}`;
  await insertDiscordUser(q, uid, discordId);
  await grantGuild(q, discordId, grantType);
  return uid;
};

// An approved signup the given account submitted, as submit_season_signup()
// stamps it.
const signedSignup = async (q, teamId, uid, nameRealm) => {
  const id = await seedSignup(q, { teamId, nameRealm });
  await q('update public.season_signups set auth_user_id = $1 where id = $2', [uid, id]);
  return id;
};

const addSignup = (asUser, uid, signupId) =>
  asUser(uid, 'select public.add_signup_to_roster($1) as id', [signupId]).then((r) => r.rows[0].id);

const membership = async (q, memberId) =>
  (await q('select role, archived_at from public.team_members where id = $1', [memberId])).rows[0];

const restoreRows = async (q, teamId) =>
  (
    await q(
      `select actor_id, target_type, target_id, detail from public.audit_log
        where team_id = $1 and action = 'team_member_restored' order by id`,
      [teamId]
    )
  ).rows;

const playerAddedDetail = async (q, playerId) =>
  (
    await q(`select detail from public.audit_log where action = 'Player Added' and target_id = $1 order by id`, [
      playerId
    ])
  ).rows.map((r) => r.detail);

describe('restore_team_member()', () => {
  it('a raider cannot call it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const raider = await seedMember(q, { teamId: team.teamId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await expect(restoreMember(asUser, raider.uid, team.teamId, team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
      expect((await membership(q, team.raider.memberId)).archived_at).not.toBeNull();
    });
  });

  it("another team's officer cannot call it", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await expect(restoreMember(asUser, other.officer.uid, team.teamId, team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
      expect((await membership(q, team.raider.memberId)).archived_at).not.toBeNull();
    });
  });

  // write_audit_log() refuses another team's officer too, but only on the way
  // to restoring someone; a current membership returns before it.
  it("another team's officer is refused on a current membership too", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      await expect(restoreMember(asUser, other.officer.uid, team.teamId, team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('refuses a membership that is not on the given team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const teamA = await seedTeam(q);
      const teamB = await seedTeam(q);
      await archiveMember(asUser, teamB.officer.uid, teamB.teamId, teamB.raider.memberId);
      await expect(restoreMember(asUser, teamA.officer.uid, teamA.teamId, teamB.raider.memberId)).rejects.toThrow(
        /not on this team/
      );
      expect((await membership(q, teamB.raider.memberId)).archived_at).not.toBeNull();
    });
  });

  it('an officer restores an archived raider, and the audit log says so', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await restoreMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'raider', archived_at: null });
      expect(await restoreRows(q, team.teamId)).toEqual([
        {
          actor_id: team.officer.uid,
          target_type: 'team_member',
          target_id: team.raider.memberId,
          detail: { role: 'raider' }
        }
      ]);
    });
  });

  it('a guild officer restores one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const guildOfficer = await seedGrant(q, 'guild_officer');
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await restoreMember(asUser, guildOfficer, team.teamId, team.raider.memberId);
      expect((await membership(q, team.raider.memberId)).archived_at).toBeNull();
    });
  });

  it('a site admin restores one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const admin = await seedGrant(q, 'site_admin');
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await restoreMember(asUser, admin, team.teamId, team.raider.memberId);
      expect((await membership(q, team.raider.memberId)).archived_at).toBeNull();
    });
  });

  it('an archived officer comes back as a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      await restoreMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'raider', archived_at: null });
    });
  });

  it('leaves a current membership alone and logs nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await restoreMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'officer', archived_at: null });
      expect(await restoreRows(q, team.teamId)).toEqual([]);
    });
  });

  it("leaves the person's archived characters archived", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      await restoreMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const player = (await q('select archived_at from public.players where id = $1', [playerId])).rows[0];
      expect(player.archived_at).not.toBeNull();
    });
  });
});

describe('add_signup_to_roster() brings an archived signer back (#1402)', () => {
  it('restores the signer with the character they played before, in the same call', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const name = `Returning${randomUUID().slice(0, 6)}-Illidan`;
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: name });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const signup = await signedSignup(q, team.teamId, team.raider.uid, name);

      const added = await addSignup(asUser, team.officer.uid, signup);

      expect(added).toBe(playerId);
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'raider', archived_at: null });
      const player = (await q('select archived_at, team_member_id from public.players where id = $1', [playerId]))
        .rows[0];
      expect(player).toEqual({ archived_at: null, team_member_id: team.raider.memberId });
      expect((await restoreRows(q, team.teamId)).map((r) => r.target_id)).toEqual([team.raider.memberId]);
      expect(await playerAddedDetail(q, playerId)).toEqual(['Mage Frost Ranged, from signup, membership restored']);
    });
  });

  it('brings an archived officer back as a raider, not an officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      const signup = await signedSignup(q, team.teamId, team.officer.uid);

      await addSignup(asUser, team.leader.uid, signup);

      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'raider', archived_at: null });
    });
  });

  it('restores an archived signer who comes back on a character new to the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const signup = await signedSignup(q, team.teamId, team.raider.uid);

      const added = await addSignup(asUser, team.officer.uid, signup);

      expect((await membership(q, team.raider.memberId)).archived_at).toBeNull();
      const player = (await q('select team_member_id from public.players where id = $1', [added])).rows[0];
      expect(player.team_member_id).toBeNull();
    });
  });

  it("leaves a current officer's membership as it is", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const signup = await signedSignup(q, team.teamId, team.officer.uid);

      const added = await addSignup(asUser, team.leader.uid, signup);

      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'officer', archived_at: null });
      expect(await restoreRows(q, team.teamId)).toEqual([]);
      expect(await playerAddedDetail(q, added)).toEqual(['Mage Frost Ranged, from signup']);
    });
  });

  it('refuses to add an archived signer when nobody is signed in', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const signup = await signedSignup(q, team.teamId, team.raider.uid);
      await expect(q('select public.add_signup_to_roster($1)', [signup])).rejects.toThrow(/Not authorized/);
    });
  });

  it('still adds a current signer when nobody is signed in', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      const signup = await signedSignup(q, team.teamId, team.raider.uid);
      await q('select public.add_signup_to_roster($1)', [signup]);
      const status = (await q('select status from public.season_signups where id = $1', [signup])).rows[0].status;
      expect(status).toBe('added');
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'raider', archived_at: null });
    });
  });
});
