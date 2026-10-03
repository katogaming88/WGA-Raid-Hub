// Behavior tests for admin_grant_team_role() and admin_revoke_team_role() on an
// archived membership (#1403). A role grant is an action above an officer's,
// so it brings an archived person back with the granted role (Option 2 on
// #1355); a revoke finds no role to take from someone archived.
//
// Each case mints its own team and archives people through
// archive_team_member(), the only way a membership is archived, and reads the
// fixture back before the call: the grant's old refusal and the revoke's
// "no role" answer would hide a fixture that is not what the case says.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

const archiveMember = (asUser, uid, teamId, memberId) =>
  asUser(uid, 'select public.archive_team_member($1, $2, $3, $4)', [teamId, memberId, 'moved_guilds', 'Left']);

const grant = (asUser, uid, teamId, discordId, role) =>
  asUser(uid, 'select public.admin_grant_team_role($1, $2, $3) as auth_user_id', [teamId, discordId, role]);

const revoke = (asUser, uid, teamId, discordId) =>
  asUser(uid, 'select public.admin_revoke_team_role($1, $2)', [teamId, discordId]);

const membership = async (q, memberId) =>
  (await q('select role, archived_at from public.team_members where id = $1', [memberId])).rows[0];

const reasons = async (q, memberId) =>
  (
    await q(
      `select r.id, r.player_id, r.reason, r.detail from public.removal_reasons r
        left join public.players p on p.id = r.player_id
        where r.team_member_id = $1 or p.team_member_id = $1 order by r.id`,
      [memberId]
    )
  ).rows;

const roleLog = async (q, memberId) =>
  (
    await q(
      `select actor_id, action, detail from public.audit_log
        where target_type = 'team_member' and target_id = $1
          and action in ('team_member_restored', 'team_role_granted', 'team_role_demoted', 'team_role_revoked')
        order by id`,
      [memberId]
    )
  ).rows;

describe('admin_grant_team_role() on an archived membership', () => {
  it('brings an archived raider back with the granted role, and logs both', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      expect(await membership(q, team.raider.memberId)).toMatchObject({
        role: 'raider',
        archived_at: expect.any(Date)
      });

      const res = await grant(asUser, team.leader.uid, team.teamId, team.raider.discordId, 'officer');

      expect(res.rows[0].auth_user_id).toBe(team.raider.uid);
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'officer', archived_at: null });
      expect(await roleLog(q, team.raider.memberId)).toEqual([
        {
          actor_id: team.leader.uid,
          action: 'team_member_restored',
          detail: { role: 'officer', archived_role: 'raider' }
        },
        {
          actor_id: team.leader.uid,
          action: 'team_role_granted',
          detail: { discord_id: team.raider.discordId, role: 'officer', linked: true, restored: true }
        }
      ]);
    });
  });

  it('an archived officer granted raider comes back as a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await membership(q, team.officer.memberId)).toMatchObject({
        role: 'officer',
        archived_at: expect.any(Date)
      });

      await grant(asUser, team.leader.uid, team.teamId, team.officer.discordId, 'raider');

      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'raider', archived_at: null });
    });
  });

  it('an archived officer granted officer comes back as an officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await membership(q, team.officer.memberId)).toMatchObject({
        role: 'officer',
        archived_at: expect.any(Date)
      });

      await grant(asUser, team.leader.uid, team.teamId, team.officer.discordId, 'officer');

      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'officer', archived_at: null });
    });
  });

  it('leaves their characters archived and every removal reason as it was', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const before = await reasons(q, team.raider.memberId);
      expect(before.map((r) => r.player_id).sort()).toEqual([null, playerId].sort());

      await grant(asUser, team.leader.uid, team.teamId, team.raider.discordId, 'officer');

      const player = (await q('select archived_at from public.players where id = $1', [playerId])).rows[0];
      expect(player.archived_at).not.toBeNull();
      expect(await reasons(q, team.raider.memberId)).toEqual(before);
    });
  });

  // Control: a sitting role is never rewritten by a grant, archived or not.
  it('still refuses a current membership, and leaves it as it is', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'raider', archived_at: null });

      await expect(grant(asUser, team.leader.uid, team.teamId, team.raider.discordId, 'officer')).rejects.toThrow(
        /already has the raider role on this team\. Change a role through the promote path/
      );
      expect(await membership(q, team.raider.memberId)).toEqual({ role: 'raider', archived_at: null });
    });
  });
});

describe('admin_revoke_team_role() on an archived membership', () => {
  it('refuses an archived officer, who holds no role to take', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await membership(q, team.officer.memberId)).toMatchObject({
        role: 'officer',
        archived_at: expect.any(Date)
      });
      expect(await reasons(q, team.officer.memberId)).toHaveLength(1);

      await expect(revoke(asUser, team.leader.uid, team.teamId, team.officer.discordId)).rejects.toThrow(
        /does not have a role on this team/
      );
    });
  });

  // Archived as postgres, so no removal reason points at the row and no
  // character does: the revoke's delete branch, which would erase it.
  it('refuses an archived row nothing points at, rather than deleting it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q('update public.team_members set archived_at = now() where id = $1', [team.officer.memberId]);
      expect(await membership(q, team.officer.memberId)).toMatchObject({
        role: 'officer',
        archived_at: expect.any(Date)
      });
      expect(await reasons(q, team.officer.memberId)).toEqual([]);
      const claimed = await q('select count(*)::int as n from public.players where team_member_id = $1', [
        team.officer.memberId
      ]);
      expect(claimed.rows[0].n).toBe(0);

      await expect(revoke(asUser, team.leader.uid, team.teamId, team.officer.discordId)).rejects.toThrow(
        /does not have a role on this team/
      );
    });
  });

  // Control: a current officer with a character is still demoted, not refused.
  it('still demotes a current officer with a character to raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await seedPlayer(q, { memberId: team.officer.memberId });
      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'officer', archived_at: null });

      await revoke(asUser, team.leader.uid, team.teamId, team.officer.discordId);

      expect(await membership(q, team.officer.memberId)).toEqual({ role: 'raider', archived_at: null });
      expect((await roleLog(q, team.officer.memberId)).map((r) => r.action)).toEqual(['team_role_demoted']);
    });
  });
});
