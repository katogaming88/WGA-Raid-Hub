// #1355's last pieces: a member makes their own Name when no officer listed
// one (create_own_name()), officers see who joined without a Name so they can
// Assign one (team_unnamed_members()), and the invite link can join a team
// before a character is picked (team_invite_link_join() with no character).
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  insertDiscordUser,
  seedTeam,
  seedPlayer,
  OFFICER_T1,
  SITE_ADMIN,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

const insertName = (q, teamId, label, memberId = null) =>
  q('insert into public.names (team_id, label, team_member_id) values ($1, $2, $3) returning id', [
    teamId,
    label,
    memberId
  ]).then((r) => r.rows[0].id);

const createOwn = (asUser, uid, teamId, label) =>
  asUser(uid, 'select public.create_own_name($1, $2) as id', [teamId, label]).then((r) => r.rows[0].id);

const unnamed = (asUser, uid, teamId) =>
  asUser(uid, 'select * from public.team_unnamed_members($1) order by team_member_id', [teamId]).then((r) => r.rows);

describe('create_own_name()', () => {
  it('anon cannot execute it', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      await expect(asAnon('select public.create_own_name($1, $2)', [team.teamId, 'Anon'])).rejects.toThrow();
    });
  });

  it('a member with no Name makes one, claimed by them', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const id = await createOwn(asUser, team.raider.uid, team.teamId, '  Katorri  ');
      const row = (await q('select label, team_member_id, role from public.names where id = $1', [id])).rows[0];
      expect(row).toEqual({ label: 'Katorri', team_member_id: team.raider.memberId, role: null });
    });
  });

  it('writes its own audit row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const id = await createOwn(asUser, team.raider.uid, team.teamId, 'Katorri');
      const { rows } = await q(
        "select actor_id, target_type, target_id, detail from public.audit_log where team_id = $1 and action = 'Name Created'",
        [team.teamId]
      );
      expect(rows).toEqual([
        {
          actor_id: team.raider.uid,
          target_type: 'names',
          target_id: id,
          detail: { label: 'Katorri', team_member_id: team.raider.memberId, self: true }
        }
      ]);
    });
  });

  it('refuses someone not on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `outsider-${uid}`);
      await expect(createOwn(asUser, uid, team.teamId, 'Outsider')).rejects.toThrow(/not on this team/);
      expect((await q('select count(*)::int as n from public.names where team_id = $1', [team.teamId])).rows[0].n).toBe(
        0
      );
    });
  });

  it('refuses an ended membership', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q('update public.team_members set archived_at = now() where id = $1', [team.raider.memberId]);
      await expect(createOwn(asUser, team.raider.uid, team.teamId, 'Gone')).rejects.toThrow(/has ended/);
    });
  });

  it('refuses a member who already holds a Name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'Already Mine', team.raider.memberId);
      await expect(createOwn(asUser, team.raider.uid, team.teamId, 'Second')).rejects.toThrow(/already have a Member/);
    });
  });

  it('refuses a label the team already has, in words', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'Alex');
      await expect(createOwn(asUser, team.raider.uid, team.teamId, ' alex ')).rejects.toThrow(
        /already has a Member called alex/
      );
    });
  });

  it('refuses a label over 40 characters, or on more than one line', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(createOwn(asUser, team.raider.uid, team.teamId, 'x'.repeat(41))).rejects.toThrow(/40 characters/);
      await expect(createOwn(asUser, team.raider.uid, team.teamId, 'Kat\nOrri')).rejects.toThrow(/one line/);
      expect(await createOwn(asUser, team.raider.uid, team.teamId, 'x'.repeat(40))).toBeTruthy();
    });
  });

  it('refuses a blank label', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(createOwn(asUser, team.raider.uid, team.teamId, '   ')).rejects.toThrow(/Type a name/);
    });
  });
});

describe('team_unnamed_members()', () => {
  it('lists current members with no Name, with their sign-in names and active character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await insertName(q, team.teamId, 'Leader Name', team.leader.memberId);
      await seedPlayer(q, { teamId: team.teamId, memberId: team.raider.memberId, nameRealm: 'Katorri-Stormrage' });
      await q(
        `update auth.identities set identity_data = identity_data || '{"full_name":"kato"}'::jsonb
          where user_id = $1 and provider = 'discord'`,
        [team.raider.uid]
      );
      await q(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
         values ($1, $2, '{"custom_claims":{"battletag":"Kato#1234"}}'::jsonb, 'custom:battlenet', now(), now())`,
        [`bnet-${team.raider.uid}`, team.raider.uid]
      );

      const rows = await unnamed(asUser, team.officer.uid, team.teamId);
      expect(rows).toEqual([
        {
          team_member_id: team.officer.memberId,
          discord_name: null,
          battletag: null,
          character_name: null
        },
        {
          team_member_id: team.raider.memberId,
          discord_name: 'kato',
          battletag: 'Kato#1234',
          character_name: 'Katorri-Stormrage'
        }
      ]);
    });
  });

  it('leaves out ended memberships', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await q('update public.team_members set archived_at = now() where id = $1', [team.raider.memberId]);
      const ids = (await unnamed(asUser, team.officer.uid, team.teamId)).map((r) => r.team_member_id);
      expect(ids).not.toContain(team.raider.memberId);
    });
  });

  it('is refused to a raider, and open to a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await expect(unnamed(asUser, team.raider.uid, team.teamId)).rejects.toThrow(/Not authorized/);
      expect((await unnamed(asUser, SITE_ADMIN, team.teamId)).length).toBe(3);
    });
  });

  it('is refused to an officer of a different team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const teamA = await seedTeam(q);
      const teamB = await seedTeam(q);
      await expect(unnamed(asUser, teamB.officer.uid, teamA.teamId)).rejects.toThrow(/Not authorized/);
    });
  });

  it("is open to a guild officer of the team's own guild", async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      expect((await unnamed(asUser, GUILD_OFFICER, team.teamId)).length).toBe(3);
    });
  });

  it('refuses a guild officer of another guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = (await q("insert into public.guilds (name) values ('Other Guild') returning id")).rows[0].id;
      await q('update public.teams set guild_id = $1 where id = $2', [other, team.teamId]);
      await expect(unnamed(asUser, GUILD_OFFICER, team.teamId)).rejects.toThrow(/Not authorized/);
    });
  });

  it('anon cannot execute it', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const team = await seedTeam(q);
      await expect(asAnon('select * from public.team_unnamed_members($1)', [team.teamId])).rejects.toThrow();
    });
  });
});

describe('team_invite_link_join() with no character', () => {
  const mint = async (asUser) =>
    (await asUser(OFFICER_T1, 'select code from public.team_invite_link_reset($1, $2)', [1, null])).rows[0].code;

  it('joins the team with no roster character, then makes their own Name', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `joiner-${uid}`);
      const outcome = (await asUser(uid, 'select public.team_invite_link_join($1, null) as o', [code])).rows[0].o;
      expect(outcome).toBe('joined');

      const member = (
        await q(
          `select tm.id, tm.role from public.team_members tm
             join public.people pe on pe.id = tm.person_id
            where tm.team_id = 1 and pe.auth_user_id = $1`,
          [uid]
        )
      ).rows[0];
      expect(member.role).toBe('raider');
      expect(
        (await q('select count(*)::int as n from public.players where team_member_id = $1', [member.id])).rows[0].n
      ).toBe(0);

      const audit = (
        await q(
          "select target_type, target_id from public.audit_log where action = 'Joined via Invite Link' and actor_id = $1",
          [uid]
        )
      ).rows;
      expect(audit).toEqual([{ target_type: 'team_members', target_id: member.id }]);

      await createOwn(asUser, uid, 1, `Joiner ${uid.slice(0, 8)}`);
    });
  });

  const noCharJoin = (asUser, uid, code) =>
    asUser(uid, 'select public.team_invite_link_join($1, null) as o', [code]).then((r) => r.rows[0].o);
  const joinRows = (q, uid) =>
    q("select count(*)::int as n from public.audit_log where action = 'Joined via Invite Link' and actor_id = $1", [
      uid
    ]).then((r) => r.rows[0].n);
  const membershipsOf = (q, uid) =>
    q(
      `select tm.id, tm.role, tm.archived_at from public.team_members tm
         join public.people pe on pe.id = tm.person_id
        where tm.team_id = 1 and pe.auth_user_id = $1`,
      [uid]
    ).then((r) => r.rows);

  it('logs one join, not one per visit or per step', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `again-${uid}`);
      await noCharJoin(asUser, uid, code);
      await noCharJoin(asUser, uid, code);
      expect(await joinRows(q, uid)).toBe(1);
    });
  });

  it('brings an archived member back as a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = randomUUID();
      const discord = `back-${uid}`;
      await q("insert into public.team_members (team_id, discord_id, role) values (1, $1, 'officer')", [discord]);
      await insertDiscordUser(q, uid, discord);
      await q('update public.team_members set archived_at = now() where discord_id = $1', [discord]);
      await noCharJoin(asUser, uid, code);
      const [row] = await membershipsOf(q, uid);
      expect({ role: row.role, archived_at: row.archived_at }).toEqual({ role: 'raider', archived_at: null });
      expect(await joinRows(q, uid)).toBe(1);
    });
  });

  it('leaves a current officer their role and logs nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      await noCharJoin(asUser, OFFICER_T1, code);
      const [row] = await membershipsOf(q, OFFICER_T1);
      expect(row.role).toBe('officer');
      expect(await joinRows(q, OFFICER_T1)).toBe(0);
    });
  });

  it('joins nothing when the character is not on the account', async () => {
    await withTxn(async ({ q, asUser }) => {
      const code = await mint(asUser);
      const uid = randomUUID();
      await insertDiscordUser(q, uid, `wrong-${uid}`);
      await expect(asUser(uid, 'select public.team_invite_link_join($1, $2)', [code, 999999999])).rejects.toThrow(
        /not on your account/
      );
      expect(await membershipsOf(q, uid)).toEqual([]);
    });
  });
});
