// Behavior tests for the names table (#1355): bare/claimed roster labels and
// claim_name() (self-service). Lives in the RLS suite because the function is
// SECURITY DEFINER and the table's officer-write policy and the cross-team
// trigger are RLS-shaped.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  insertDiscordUser,
  seedTeam,
  seedMember,
  rowLockModes,
  SITE_ADMIN,
  GUILD_OFFICER
} from './helpers.js';

const insertName = (q, teamId, label, memberId = null) =>
  q('insert into public.names (team_id, label, team_member_id) values ($1, $2, $3) returning id', [
    teamId,
    label,
    memberId
  ]).then((r) => r.rows[0].id);

const claimName = (asUser, uid, teamId, nameId) => asUser(uid, 'select public.claim_name($1, $2)', [teamId, nameId]);

describe('names table RLS', () => {
  it('anon reads names (public)', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'Anon Read Test');
      const res = await asAnon('select label from public.names where team_id = $1', [team.teamId]);
      expect(res.rows.map((r) => r.label)).toEqual(['Anon Read Test']);
    });
  });

  it('an officer can create and rename a bare Name; a raider cannot', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await asUser(team.officer.uid, "insert into public.names (team_id, label) values ($1, 'Officer Made')", [
        team.teamId
      ]);
      const created = (await q('select id, label from public.names where team_id = $1', [team.teamId])).rows;
      expect(created).toHaveLength(1);

      await expect(
        asUser(team.raider.uid, "insert into public.names (team_id, label) values ($1, 'Raider Made')", [team.teamId])
      ).rejects.toThrow();
      const afterRaiderInsert = (
        await q('select count(*)::int as n from public.names where team_id = $1', [team.teamId])
      ).rows[0].n;
      expect(afterRaiderInsert).toBe(1);

      await asUser(team.officer.uid, "update public.names set label = 'Renamed' where id = $1", [created[0].id]);
      const relabeled = (await q('select label from public.names where id = $1', [created[0].id])).rows[0].label;
      expect(relabeled).toBe('Renamed');
    });
  });

  it('an officer can set a bare Name to a raid role; an invalid one is rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Needs A Tank');
      await asUser(team.officer.uid, "update public.names set role = 'Tank' where id = $1", [nameId]);
      expect((await q('select role from public.names where id = $1', [nameId])).rows[0].role).toBe('Tank');

      await expect(
        asUser(team.officer.uid, "update public.names set role = 'DPS' where id = $1", [nameId])
      ).rejects.toThrow();
    });
  });

  it("a names row cannot point at another team's membership (cross-team trigger)", async () => {
    await withTxn(async ({ q, asUser }) => {
      const teamA = await seedTeam(q);
      const teamB = await seedTeam(q);
      const nameId = await insertName(q, teamA.teamId, 'Cross Team');
      await expect(
        asUser(teamA.officer.uid, 'update public.names set team_member_id = $1 where id = $2', [
          teamB.raider.memberId,
          nameId
        ])
      ).rejects.toThrow(/not on this team/);
    });
  });

  it('a label cannot repeat on a team, case- and whitespace-insensitively', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'Alex');
      await expect(
        asUser(team.officer.uid, "insert into public.names (team_id, label) values ($1, '  alex ')", [team.teamId])
      ).rejects.toThrow();
    });
  });

  it('a blank label is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(
        asUser(team.officer.uid, "insert into public.names (team_id, label) values ($1, '   ')", [team.teamId])
      ).rejects.toThrow();
    });
  });

  it('a membership can be claimed by only one Name (unique index)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'First Claimant', team.raider.memberId);
      const secondId = await insertName(q, team.teamId, 'Second Claimant');
      await expect(
        asUser(team.officer.uid, 'update public.names set team_member_id = $1 where id = $2', [
          team.raider.memberId,
          secondId
        ])
      ).rejects.toThrow();
    });
  });
});

describe('claim_name', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Anon Claim Attempt');
      await expect(asAnon('select public.claim_name($1, $2)', [team.teamId, nameId])).rejects.toThrow();
    });
  });

  it('an existing member claims a bare Name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Claim Me');
      await claimName(asUser, team.raider.uid, team.teamId, nameId);
      const row = (await q('select team_member_id from public.names where id = $1', [nameId])).rows[0];
      expect(row.team_member_id).toBe(team.raider.memberId);
    });
  });

  it('a caller with no membership yet gets one created from their Discord identity', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const uid = randomUUID();
      const discordId = `fixture-${randomUUID()}`;
      await insertDiscordUser(q, uid, discordId);
      const nameId = await insertName(q, team.teamId, 'Brand New Claimant');

      await claimName(asUser, uid, team.teamId, nameId);

      const members = (await q('select id, role, discord_id from public.team_members where auth_user_id = $1', [uid]))
        .rows;
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('raider');
      expect(members[0].discord_id).toBe(discordId);

      const row = (await q('select team_member_id from public.names where id = $1', [nameId])).rows[0];
      expect(row.team_member_id).toBe(members[0].id);
    });
  });

  it('refuses a Name that is already claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Taken', team.leader.memberId);
      await expect(claimName(asUser, team.raider.uid, team.teamId, nameId)).rejects.toThrow(/not available to claim/);
    });
  });

  it('refuses a caller with no Discord identity and no existing membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const uid = randomUUID();
      // A Battle.net-only account: signed in, no Discord identity at all.
      await q(
        `insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
         values ($1, 'authenticated', 'authenticated', $2, 'x', '{}'::jsonb, '{}'::jsonb)`,
        [uid, `no-discord-${uid}@example.com`]
      );
      const nameId = await insertName(q, team.teamId, 'No Discord Claimant');
      await expect(claimName(asUser, uid, team.teamId, nameId)).rejects.toThrow(/no Discord identity/);
    });
  });

  it("refuses to un-archive the caller's own ended membership -- coming back takes an officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q('update public.team_members set archived_at = now() where id = $1', [team.raider.memberId]);
      const nameId = await insertName(q, team.teamId, 'Returning Raider');

      await expect(claimName(asUser, team.raider.uid, team.teamId, nameId)).rejects.toThrow(/has ended/);

      const member = (await q('select archived_at from public.team_members where id = $1', [team.raider.memberId]))
        .rows[0];
      expect(member.archived_at).not.toBeNull();
      const name = (await q('select team_member_id from public.names where id = $1', [nameId])).rows[0];
      expect(name.team_member_id).toBeNull();
    });
  });
});

describe('the same-team check runs on every write', () => {
  it('refuses moving a claimed Name to another team by team_id alone, for a site admin and an officer of both teams', async () => {
    await withTxn(async ({ q, asUser }) => {
      const teamA = await seedTeam(q);
      const teamB = await seedTeam(q);
      const nameId = await insertName(q, teamA.teamId, 'Stays Home', teamA.raider.memberId);
      const both = await seedMember(q, { teamId: teamA.teamId, role: 'officer' });
      await q("insert into public.team_members (team_id, discord_id, role) values ($1, $2, 'officer')", [
        teamB.teamId,
        both.discordId
      ]);

      for (const uid of [SITE_ADMIN, both.uid]) {
        await expect(
          asUser(uid, 'update public.names set team_id = $1 where id = $2', [teamB.teamId, nameId])
        ).rejects.toThrow(/^That membership is not on this team$/);
      }
      const row = (await q('select team_id, team_member_id from public.names where id = $1', [nameId])).rows[0];
      expect(row).toEqual({ team_id: teamA.teamId, team_member_id: teamA.raider.memberId });
    });
  });
});

describe('claim_name() checks the Name first', () => {
  it('refuses a claim against a team that does not exist with its own sentence', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Somewhere Else');
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `fixture-${randomUUID()}`);
      const missingTeam = (await q('select coalesce(max(id), 0) + 1000 as id from public.teams')).rows[0].id;

      await expect(claimName(asUser, uid, missingTeam, nameId)).rejects.toThrow(
        /^That Name is not available to claim$/
      );
    });
  });
});

describe('claim_name() and a second Name', () => {
  it('refuses someone who already holds a Name, in a sentence, and leaves the second Name bare', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'First Pick', team.raider.memberId);
      const secondId = await insertName(q, team.teamId, 'Second Pick');

      await expect(claimName(asUser, team.raider.uid, team.teamId, secondId)).rejects.toThrow(
        /^You already have a Name on this team\. Ask an officer if it needs changing\.$/
      );
      const second = (await q('select team_member_id from public.names where id = $1', [secondId])).rows[0];
      expect(second.team_member_id).toBeNull();
    });
  });
});

describe('claim_name() leaves an audit row', () => {
  it('writes one Name Claimed row per claim, naming the Name, the claimer and whether a membership was created', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const memberNameId = await insertName(q, team.teamId, 'Already Here');
      await claimName(asUser, team.raider.uid, team.teamId, memberNameId);

      const uid = randomUUID();
      await insertDiscordUser(q, uid, `fixture-${randomUUID()}`);
      const newcomerNameId = await insertName(q, team.teamId, 'Just Arrived');
      await claimName(asUser, uid, team.teamId, newcomerNameId);
      const newcomerMemberId = (
        await q('select id from public.team_members where team_id = $1 and auth_user_id = $2', [team.teamId, uid])
      ).rows[0].id;

      const rows = (
        await q(
          `select actor_id, target_type, target_id, detail from public.audit_log
            where team_id = $1 and action = 'Name Claimed' order by id`,
          [team.teamId]
        )
      ).rows;
      expect(rows).toEqual([
        {
          actor_id: team.raider.uid,
          target_type: 'names',
          target_id: memberNameId,
          detail: { label: 'Already Here', team_member_id: team.raider.memberId, membership_created: false }
        },
        {
          actor_id: uid,
          target_type: 'names',
          target_id: newcomerNameId,
          detail: { label: 'Just Arrived', team_member_id: newcomerMemberId, membership_created: true }
        }
      ]);
    });
  });
});

describe('who can write a Name, and what survives a membership ending', () => {
  it("leaves a raider's update and delete with nothing changed", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Untouched');
      const updated = await asUser(team.raider.uid, "update public.names set label = 'Raider Was Here' where id = $1", [
        nameId
      ]);
      const deleted = await asUser(team.raider.uid, 'delete from public.names where id = $1', [nameId]);
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
      expect((await q('select label from public.names where id = $1', [nameId])).rows).toEqual([
        { label: 'Untouched' }
      ]);
    });
  });

  it("refuses another team's officer", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Not Yours');
      await expect(
        asUser(other.officer.uid, "insert into public.names (team_id, label) values ($1, 'Planted')", [team.teamId])
      ).rejects.toThrow(/row-level security/);
      const updated = await asUser(other.officer.uid, "update public.names set label = 'Taken Over' where id = $1", [
        nameId
      ]);
      expect(updated.rowCount).toBe(0);
      expect((await q('select label from public.names where team_id = $1', [team.teamId])).rows).toEqual([
        { label: 'Not Yours' }
      ]);
    });
  });

  it('refuses a Name from another team and creates no membership on the team named', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const otherNameId = await insertName(q, other.teamId, 'Over There');
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `fixture-${randomUUID()}`);

      await expect(claimName(asUser, uid, team.teamId, otherNameId)).rejects.toThrow(
        /^That Name is not available to claim$/
      );
      const members = await q('select id from public.team_members where auth_user_id = $1', [uid]);
      expect(members.rows).toEqual([]);
    });
  });

  it('lets an officer assign a bare Name to a member of the team and remove the claim again', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Assigned By Hand');
      const claimedBy = () => q('select team_member_id from public.names where id = $1', [nameId]);

      await asUser(team.officer.uid, 'update public.names set team_member_id = $1 where id = $2', [
        team.raider.memberId,
        nameId
      ]);
      expect((await claimedBy()).rows[0].team_member_id).toBe(team.raider.memberId);
      await asUser(team.officer.uid, 'update public.names set team_member_id = null where id = $1', [nameId]);
      expect((await claimedBy()).rows[0].team_member_id).toBeNull();
    });
  });

  it('lets an officer and a guild officer rename a claimed Name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Old Label', team.raider.memberId);
      await asUser(team.officer.uid, "update public.names set label = 'Officer Label' where id = $1", [nameId]);
      expect((await q('select label from public.names where id = $1', [nameId])).rows[0].label).toBe('Officer Label');
      await asUser(GUILD_OFFICER, "update public.names set label = 'Guild Label' where id = $1", [nameId]);
      expect((await q('select label from public.names where id = $1', [nameId])).rows[0].label).toBe('Guild Label');
    });
  });

  it('keeps a Name linked and its label taken after Archive Member, and a restore finds it theirs', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Gone For Now', team.raider.memberId);
      await asUser(team.officer.uid, "select public.archive_team_member($1, $2, 'other', 'Taking a break')", [
        team.teamId,
        team.raider.memberId
      ]);
      const archivedAt = async () =>
        (await q('select archived_at from public.team_members where id = $1', [team.raider.memberId])).rows[0]
          .archived_at;
      expect(await archivedAt()).not.toBeNull();
      const linked = () => q('select team_member_id from public.names where id = $1', [nameId]);
      expect((await linked()).rows[0].team_member_id).toBe(team.raider.memberId);
      await expect(
        asUser(team.officer.uid, "insert into public.names (team_id, label) values ($1, 'gone for now')", [team.teamId])
      ).rejects.toThrow(/names_team_id_label_key/);

      await asUser(team.officer.uid, 'select public.restore_team_member($1, $2)', [team.teamId, team.raider.memberId]);
      expect(await archivedAt()).toBeNull();
      expect((await linked()).rows[0].team_member_id).toBe(team.raider.memberId);
    });
  });

  it('deletes the Name when a revoke deletes a membership with no character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Revoked', team.raider.memberId);
      await asUser(team.leader.uid, 'select public.admin_revoke_team_role($1, $2)', [
        team.teamId,
        team.raider.discordId
      ]);
      expect((await q('select id from public.team_members where id = $1', [team.raider.memberId])).rows).toEqual([]);
      expect((await q('select id from public.names where id = $1', [nameId])).rows).toEqual([]);
    });
  });
});

describe('claim_name() and an archive at the same moment', () => {
  it("holds a share lock on the caller's membership until it commits, as claim_character() does", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const nameId = await insertName(q, team.teamId, 'Locked In');
      await claimName(asUser, team.raider.uid, team.teamId, nameId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For Share');
    });
  });
});

afterAll(() => pool.end());
