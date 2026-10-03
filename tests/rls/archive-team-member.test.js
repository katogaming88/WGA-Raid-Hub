// Behavior tests for archive_team_member() (#1355): an officer ends someone's
// membership by archiving it, never by deleting it, so every character that
// points at it keeps its history. Lives in the RLS suite because the function
// is SECURITY DEFINER and the team_members write policies are RLS-shaped.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, seedTeam, seedMember, seedPlayer } from './helpers.js';

// The reason is one of the six player_officer_notes accepts, the same list the
// Roster tab offers when it removes a raider (#476).
const archiveMember = (asUser, uid, teamId, memberId, reason = 'moved_guilds', detail = 'Joined another guild') =>
  asUser(uid, 'select public.archive_team_member($1, $2, $3, $4)', [teamId, memberId, reason, detail]);

// Someone with a guild-wide grant and no membership on the team.
const seedGrant = async (q, grantType) => {
  const uid = randomUUID();
  const discordId = `fixture-${randomUUID()}`;
  await insertDiscordUser(q, uid, discordId);
  await grantGuild(q, discordId, grantType);
  return uid;
};

const archivedAt = async (q, memberId) =>
  (await q('select archived_at from public.team_members where id = $1', [memberId])).rows[0].archived_at;

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
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      await expect(archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId)).rejects.toThrow(
        /Not authorized/
      );
    });
  });
});

// Each predicate on its own: archive_team_member() reads my_officer_team_ids()
// and write_audit_log() reads my_team_role(), so the case above still passes
// when either one alone counts an archived row.
describe('an archived membership no longer counts in any role predicate', () => {
  const ask = async (asUser, uid, call, params = []) => (await asUser(uid, `select ${call} as v`, params)).rows[0].v;

  it('my_team_role() is null for an archived officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect(await ask(asUser, team.officer.uid, 'public.my_team_role($1)', [team.teamId])).toBe('officer');
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await ask(asUser, team.officer.uid, 'public.my_team_role($1)', [team.teamId])).toBeNull();
    });
  });

  it('my_officer_team_ids() leaves out the team for an archived officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect(await ask(asUser, team.officer.uid, 'public.my_officer_team_ids()')).toContain(team.teamId);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await ask(asUser, team.officer.uid, 'public.my_officer_team_ids()')).not.toContain(team.teamId);
    });
  });

  it('is_any_team_officer() is false for an archived officer with no other team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect(await ask(asUser, team.officer.uid, 'public.is_any_team_officer()')).toBe(true);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await ask(asUser, team.officer.uid, 'public.is_any_team_officer()')).toBe(false);
    });
  });

  it('my_leader_team_ids() leaves out the team for an archived team leader', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const admin = await seedGrant(q, 'site_admin');
      expect(await ask(asUser, team.leader.uid, 'public.my_leader_team_ids()')).toContain(team.teamId);
      await archiveMember(asUser, admin, team.teamId, team.leader.memberId);
      expect(await ask(asUser, team.leader.uid, 'public.my_leader_team_ids()')).not.toContain(team.teamId);
    });
  });

  it('is_team_leader_anywhere() is false for an archived team leader with no other team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const admin = await seedGrant(q, 'site_admin');
      expect(await ask(asUser, team.leader.uid, 'public.is_team_leader_anywhere()')).toBe(true);
      await archiveMember(asUser, admin, team.teamId, team.leader.memberId);
      expect(await ask(asUser, team.leader.uid, 'public.is_team_leader_anywhere()')).toBe(false);
    });
  });
});

describe('archive_team_member: an officer is archived by the team leader or a site admin, the leader by a site admin', () => {
  const LEADER_OR_ADMIN = /team leader or a site admin/;
  const ADMIN_ONLY = /Only a site admin can archive the team leader/;

  it('an officer cannot archive the team leader', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(archiveMember(asUser, team.officer.uid, team.teamId, team.leader.memberId)).rejects.toThrow(
        ADMIN_ONLY
      );
      expect(await archivedAt(q, team.leader.memberId)).toBeNull();
    });
  });

  it('an officer cannot archive another officer, or their own membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const second = await seedMember(q, { teamId: team.teamId, role: 'officer' });
      await expect(archiveMember(asUser, team.officer.uid, team.teamId, second.memberId)).rejects.toThrow(
        LEADER_OR_ADMIN
      );
      await expect(archiveMember(asUser, team.officer.uid, team.teamId, team.officer.memberId)).rejects.toThrow(
        LEADER_OR_ADMIN
      );
      expect(await archivedAt(q, second.memberId)).toBeNull();
      expect(await archivedAt(q, team.officer.memberId)).toBeNull();
    });
  });

  it('a guild officer cannot archive an officer, but can still archive a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const guildOfficer = await seedGrant(q, 'guild_officer');
      await expect(archiveMember(asUser, guildOfficer, team.teamId, team.officer.memberId)).rejects.toThrow(
        LEADER_OR_ADMIN
      );
      await archiveMember(asUser, guildOfficer, team.teamId, team.raider.memberId);
      expect(await archivedAt(q, team.raider.memberId)).not.toBeNull();
    });
  });

  // A team with no active leader can only be given one by a site admin, so the
  // leader's own archive belongs to a site admin too.
  it('the team leader cannot archive their own membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(archiveMember(asUser, team.leader.uid, team.teamId, team.leader.memberId)).rejects.toThrow(
        ADMIN_ONLY
      );
      expect(await archivedAt(q, team.leader.memberId)).toBeNull();
    });
  });

  it('the team leader can archive an officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.leader.uid, team.teamId, team.officer.memberId);
      expect(await archivedAt(q, team.officer.memberId)).not.toBeNull();
    });
  });

  it('a site admin can archive the team leader', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const admin = await seedGrant(q, 'site_admin');
      await archiveMember(asUser, admin, team.teamId, team.leader.memberId);
      expect(await archivedAt(q, team.leader.memberId)).not.toBeNull();
    });
  });
});

describe('archive_team_member: why they left', () => {
  const notesFor = async (q, playerId) =>
    (
      await q(
        'select officer_notes, archived_reason, archived_reason_detail from public.player_officer_notes where player_id = $1',
        [playerId]
      )
    ).rows;
  const archiveAudits = async (q, memberId) =>
    (
      await q(
        "select detail from public.audit_log where action = 'team_member_archived' and target_id = $1 order by id",
        [memberId]
      )
    ).rows.map((r) => r.detail);

  it('records the reason on every character it archives', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const main = await seedPlayer(q, { memberId: team.raider.memberId });
      const alt = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'schedule_conflict', 'New job');
      for (const id of [main, alt]) {
        expect(await notesFor(q, id)).toEqual([
          { officer_notes: null, archived_reason: 'schedule_conflict', archived_reason_detail: 'New job' }
        ]);
      }
    });
  });

  it('keeps an officer note already on the character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await q(
        "insert into public.player_officer_notes (player_id, team_id, officer_notes) values ($1, $2, 'Strong on Dimensius')",
        [playerId, team.teamId]
      );
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      expect(await notesFor(q, playerId)).toEqual([
        {
          officer_notes: 'Strong on Dimensius',
          archived_reason: 'moved_guilds',
          archived_reason_detail: 'Joined another guild'
        }
      ]);
    });
  });

  it('leaves a character archived earlier with the reason it already had', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const old = await seedPlayer(q, { memberId: team.raider.memberId, archivedAt: '2026-01-01T00:00:00Z' });
      await q(
        "insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail) values ($1, $2, 'switching_mains', 'Swapped to a Paladin')",
        [old, team.teamId]
      );
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'drama', 'Left mid-raid');
      expect(await notesFor(q, old)).toEqual([
        { officer_notes: null, archived_reason: 'switching_mains', archived_reason_detail: 'Swapped to a Paladin' }
      ]);
    });
  });

  it('a second archive changes nothing: the first reason stays and nothing more is logged', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'moved_guilds', 'First');
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'drama', 'Second');
      expect((await notesFor(q, playerId))[0].archived_reason_detail).toBe('First');
      expect(await archiveAudits(q, team.raider.memberId)).toHaveLength(1);
    });
  });

  it('refuses a reason outside the six, and archives nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(
        archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'bored', 'x')
      ).rejects.toThrow(/not one of the reasons/);
      expect(await archivedAt(q, team.raider.memberId)).toBeNull();
    });
  });

  it('logs the reason, the detail and the characters archived, even for a member with none', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId, 'performance', 'Missed cutoffs');
      const solo = await seedMember(q, { teamId: team.teamId });
      const playerId = await seedPlayer(q, { memberId: solo.memberId });
      await archiveMember(asUser, team.officer.uid, team.teamId, solo.memberId, 'other', 'Took a break');
      expect(await archiveAudits(q, team.raider.memberId)).toEqual([
        { reason: 'performance', detail: 'Missed cutoffs', player_ids: [] }
      ]);
      expect(await archiveAudits(q, solo.memberId)).toEqual([
        { reason: 'other', detail: 'Took a break', player_ids: [playerId] }
      ]);
    });
  });

  // #1392's trigger on players.archived_at does this for every path that
  // archives a character; this pins that archive_team_member() is one of them.
  it('takes the archived characters off the live priority lists', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const playerId = await seedPlayer(q, { memberId: team.raider.memberId });
      const season = (await q('select public.current_season() as code')).rows[0].code;
      await q(
        "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values ($1, $2, 1, 'Myth', 1, $3)",
        [team.teamId, season, playerId]
      );
      await archiveMember(asUser, team.officer.uid, team.teamId, team.raider.memberId);
      const left = await q('select 1 from public.priority_order where player_id = $1 and season = $2', [
        playerId,
        season
      ]);
      expect(left.rows).toHaveLength(0);
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

  // Editing archived_at directly would skip everything Archive Member does
  // (the characters, the reason, the audit row) and leave a half-archived
  // membership, so the column only changes inside the two database functions.
  it('a team leader cannot archive or restore a membership by editing the row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(
        asUser(team.leader.uid, 'update public.team_members set archived_at = now() where id = $1', [
          team.raider.memberId
        ])
      ).rejects.toThrow(/Archive Member/);
      await q('update public.team_members set archived_at = now() where id = $1', [team.raider.memberId]);
      await expect(
        asUser(team.leader.uid, 'update public.team_members set archived_at = null where id = $1', [
          team.raider.memberId
        ])
      ).rejects.toThrow(/Archive Member/);
      expect(await archivedAt(q, team.raider.memberId)).not.toBeNull();
    });
  });

  it('a site admin cannot either', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const admin = await seedGrant(q, 'site_admin');
      await expect(
        asUser(admin, 'update public.team_members set archived_at = now() where id = $1', [team.raider.memberId])
      ).rejects.toThrow(/Archive Member/);
      expect(await archivedAt(q, team.raider.memberId)).toBeNull();
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
