// Behavior tests for the names table (#1355): bare/claimed roster labels and
// claim_name() (self-service). Lives in the RLS suite because the function is
// SECURITY DEFINER and the table's officer-write policy and the cross-team
// trigger are RLS-shaped.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, seedTeam, seedMember, SITE_ADMIN } from './helpers.js';

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

afterAll(() => pool.end());
