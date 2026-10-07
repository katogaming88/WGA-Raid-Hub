// Behavior tests for #1432: Remove and a signup add hold the membership before
// they touch a character, the order archive_team_member() takes, so the two
// wait behind each other instead of deadlocking. Each call's held locks are
// read with rowLockModes(); the order itself is a review item, measured by a
// two-session script on the pull request.
//
// The callers are the team's plain officer unless a case says otherwise: a
// share lock on a membership is filtered by its UPDATE policy, which only
// team leaders and site admins pass, so only an owner-rights hold reaches the
// row for an officer. Each case mints its own team (seedTeam).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, seedSignup, rowLockModes, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const archivePlayer = (asUser, uid, playerId) =>
  asUser(uid, 'select public.archive_player($1, $2, $3)', [playerId, 'moved_guilds', 'Joined another guild']);

const signedSignup = async (q, teamId, uid) => {
  const id = await seedSignup(q, { teamId });
  await q('update public.season_signups set auth_user_id = $1 where id = $2', [uid, id]);
  return id;
};

const addSignup = (asUser, uid, signupId, archiveId = null) =>
  asUser(uid, 'select public.add_signup_to_roster($1, true, $2) as id', [signupId, archiveId]);

const hold = (call, memberId) => call('select public.hold_team_member($1)', [memberId]);

describe('Remove holds the membership first', () => {
  it("an officer's Remove holds the character's membership", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it("a team leader's Remove holds it too", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archivePlayer(asUser, team.leader.uid, playerId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it('removes a character with no membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { teamId: team.teamId });
      await archivePlayer(asUser, team.officer.uid, playerId);
      const { rows } = await q('select archived_at from public.players where id = $1', [playerId]);
      expect(rows[0].archived_at).toBeInstanceOf(Date);
    });
  });

  it('still says a character already off the roster is already archived', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId, archivedAt: new Date('2026-01-01') });
      await expect(archivePlayer(asUser, team.officer.uid, playerId)).rejects.toThrow(/already archived/);
    });
  });
});

describe('A signup add holds the memberships first', () => {
  it("an add holds the signer's membership", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const signup = await signedSignup(q, team.teamId, team.raider.uid);
      await addSignup(asUser, team.officer.uid, signup);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it("a main swap holds the old character's membership", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const oldId = await seedPlayer(q, { memberId: team.raider.memberId });
      const signup = await seedSignup(q, { teamId: team.teamId });
      await addSignup(asUser, team.officer.uid, signup, oldId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it("a main swap from someone else's character holds both memberships", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const oldId = await seedPlayer(q, { memberId: team.leader.memberId });
      const signup = await signedSignup(q, team.teamId, team.raider.uid);
      await addSignup(asUser, team.officer.uid, signup, oldId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
      expect(await rowLockModes(q, 'team_members', team.leader.memberId)).toContain('For Share');
    });
  });

  // What a swap that waited behind Archive Member finds: the old character
  // already off the roster, with the reason it left keyed on that date.
  it('a main swap from a character already off the roster leaves when it left', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const left = new Date('2026-01-01T12:00:00Z');
      const oldId = await seedPlayer(q, { memberId: team.raider.memberId, archivedAt: left });
      await q(
        `insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
         values ($1, $2, 'moved_guilds', 'Joined another guild')`,
        [oldId, team.teamId]
      );
      const signup = await signedSignup(q, team.teamId, team.raider.uid);
      await addSignup(asUser, team.officer.uid, signup, oldId);
      const old = (await q('select archived_at from public.players where id = $1', [oldId])).rows[0];
      expect(old.archived_at).toEqual(left);
      const reasons = (await q('select removed_at from public.removal_reasons where player_id = $1', [oldId])).rows;
      expect(reasons).toEqual([{ removed_at: left }]);
    });
  });
});

describe('hold_team_member()', () => {
  it("holds the membership for the team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await hold((t, p) => asUser(team.officer.uid, t, p), team.raider.memberId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it('holds it for a guild officer and a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await hold((t, p) => asUser(GUILD_OFFICER, t, p), team.raider.memberId);
      await hold((t, p) => asUser(SITE_ADMIN, t, p), team.officer.memberId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
      expect(await rowLockModes(q, 'team_members', team.officer.memberId)).toContain('For Share');
    });
  });

  it('holds it with nobody signed in, as the database owner adds a signup', async () => {
    await withTxn(async ({ q }) => {
      const team = await seedTeam(q);
      await hold(q, team.raider.memberId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });

  it("refuses a raider on the membership's team", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(hold((t, p) => asUser(team.raider.uid, t, p), team.leader.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('refuses an officer of another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      await expect(hold((t, p) => asUser(other.officer.uid, t, p), team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('refuses a membership that does not exist', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(hold((t, p) => asUser(team.officer.uid, t, p), -1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('does nothing for a character with no membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(hold((t, p) => asUser(team.officer.uid, t, p), null)).resolves.toBeDefined();
    });
  });

  it('cannot be run signed out', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      await expect(hold(asAnon, team.raider.memberId)).rejects.toThrow(/permission denied/);
    });
  });
});
