// Behavior tests for archive_team_member() (#1355): an officer ends someone's
// membership by archiving it, never by deleting it, so every character that
// points at it keeps its history. Lives in the RLS suite because the function
// is SECURITY DEFINER and the team_members write policies are RLS-shaped.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer } from './helpers.js';

const archiveMember = (asUser, uid, teamId, memberId) =>
  asUser(uid, 'select public.archive_team_member($1, $2)', [teamId, memberId]);

describe('archive_team_member ("Delete Member")', () => {
  it('a raider cannot call it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(archiveMember(asUser, team.raider.uid, team.teamId, team.leader.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('refuses a membership that is not on the given team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const teamA = await seedTeam(q);
      const teamB = await seedTeam(q);
      await expect(archiveMember(asUser, teamA.officer.uid, teamA.teamId, teamB.raider.memberId)).rejects.toThrow(
        /not on this team/
      );
    });
  });

  it('archives a member and their active characters, without deleting anything', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm: 'Leaving-Illidan' });
      const archivedPlayerId = await seedPlayer(q, {
        memberId: team.raider.memberId,
        nameRealm: 'AlreadyGone-Illidan',
        archivedAt: '2026-01-01T00:00:00Z'
      });

      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);

      const member = (await q('select archived_at from public.team_members where id = $1', [team.raider.memberId]))
        .rows[0];
      expect(member.archived_at).not.toBeNull();

      // The team_member_id link survives: archiving is not deleting, so a
      // departed raider's characters still say whose they were.
      const player = (await q('select team_member_id, archived_at from public.players where id = $1', [playerId]))
        .rows[0];
      expect(player.team_member_id).toBe(team.raider.memberId);
      expect(player.archived_at).not.toBeNull();

      // An already-archived character keeps its original archive date.
      const already = (await q('select archived_at from public.players where id = $1', [archivedPlayerId])).rows[0];
      expect(already.archived_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  it('archives a member with no characters without error', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const member = (await q('select archived_at from public.team_members where id = $1', [team.raider.memberId]))
        .rows[0];
      expect(member.archived_at).not.toBeNull();
    });
  });

  it('an archived officer no longer counts as an officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.officer.memberId);
      await expect(archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });
});

describe('team_members RLS after the archive change', () => {
  it('a team leader can no longer delete a membership directly', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      // No policy grants DELETE any more, so RLS filters the row out of the
      // statement rather than raising: it "succeeds" at deleting nothing.
      const result = await asUser(team.leader.uid, 'delete from public.team_members where id = $1', [
        team.raider.memberId
      ]);
      expect(result.rowCount).toBe(0);
      const still = (await q('select id from public.team_members where id = $1', [team.raider.memberId])).rows;
      expect(still).toHaveLength(1);
    });
  });

  it('a team leader can still update a membership (role changes)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.leader.uid, "update public.team_members set role = 'officer' where id = $1", [
        team.raider.memberId
      ]);
      const role = (await q('select role from public.team_members where id = $1', [team.raider.memberId])).rows[0].role;
      expect(role).toBe('officer');
    });
  });
});

afterAll(() => pool.end());
