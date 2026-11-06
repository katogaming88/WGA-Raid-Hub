// #1651: changing a team rank and the Team Owner. On Phoenix (team 1) the seed
// makes TEAM_LEADER_T1 the Team Owner, OFFICER_T1 an Officer and RAIDER_T1 a
// Raider. TEAM_LEADER_T3 is We Go Again's Owner and GUILD_OFFICER an Admin.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
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
const memberOf = async (q, uid, team = T1) =>
  (
    await q(
      `select m.id from public.team_members m
         join public.people p on p.id = m.person_id
        where p.auth_user_id = $1 and m.team_id = $2`,
      [uid, team]
    )
  ).rows[0].id;
const row = async (q, id) => (await q('select rank, role from public.team_members where id = $1', [id])).rows[0];
const setRank = (asUser, uid, member, rank) =>
  asUser(uid, 'select public.set_team_rank($1, $2, $3)', [T1, member, rank]);
const changeOwner = (asUser, uid, member, team = T1) =>
  asUser(uid, 'select public.change_team_owner($1, $2)', [team, member]);
const refusal = (run) =>
  withTxn(async (ctx) => {
    let message = null;
    try {
      await run(ctx);
    } catch (e) {
      message = e.message;
    }
    return message;
  });

describe('set_team_rank', () => {
  it('the Team Owner makes a Raider an Officer and back, the old role following, with an audit row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await setRank(asUser, TEAM_LEADER_T1, raider, 'officer');
      expect(await row(q, raider)).toEqual({ rank: 'officer', role: 'officer' });
      await setRank(asUser, TEAM_LEADER_T1, raider, 'raider');
      expect(await row(q, raider)).toEqual({ rank: 'raider', role: 'raider' });
      const audit = await q(
        `select detail from public.audit_log
          where action = 'Team Rank Changed' and team_id = $1 and target_id = $2 order by id`,
        [T1, raider]
      );
      expect(audit.rows.map((r) => r.detail)).toEqual([
        { from: 'raider', to: 'officer' },
        { from: 'officer', to: 'raider' }
      ]);
    });
  });

  it('an Officer moves someone between Raider and Assistant', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await setRank(asUser, OFFICER_T1, raider, 'assistant');
      expect(await row(q, raider)).toEqual({ rank: 'assistant', role: 'raider' });
      await setRank(asUser, OFFICER_T1, raider, 'raider');
      expect((await row(q, raider)).rank).toBe('raider');
    });
  });

  it('an Officer cannot make or unmake an Officer', async () => {
    const make = await refusal(async ({ q, asUser }) =>
      setRank(asUser, OFFICER_T1, await memberOf(q, RAIDER_T1), 'officer')
    );
    expect(make).toMatch(/Only the Team Owner/);
    const unmake = await refusal(async ({ q, asUser }) =>
      setRank(asUser, OFFICER_T1, await memberOf(q, OFFICER_T1), 'raider')
    );
    expect(unmake).toMatch(/Only the Team Owner/);
  });

  it('switching promote_assistants off on the grid refuses an Officer at once', async () => {
    const message = await refusal(async ({ q, asUser }) => {
      await q(
        `delete from public.team_rank_permissions
          where team_id = $1 and rank = 'officer' and permission = 'promote_assistants'`,
        [T1]
      );
      await setRank(asUser, OFFICER_T1, await memberOf(q, RAIDER_T1), 'assistant');
    });
    expect(message).toMatch(/Not authorized/);
  });

  it('refuses a Raider, an officer of another team, a guild Admin and a site admin', async () => {
    for (const uid of [RAIDER_T1, OFFICER_T2, GUILD_OFFICER, SITE_ADMIN]) {
      const message = await refusal(async ({ q, asUser }) =>
        setRank(asUser, uid, await memberOf(q, RAIDER_T1), 'assistant')
      );
      expect(message, uid).toMatch(/Not authorized/);
    }
  });

  it('refuses the Team Owner as a target, or as a new rank, and a member of another team', async () => {
    const owner = await refusal(async ({ q, asUser }) =>
      setRank(asUser, TEAM_LEADER_T1, await memberOf(q, TEAM_LEADER_T1), 'raider')
    );
    expect(owner).toMatch(/is the Team Owner/);
    const toOwner = await refusal(async ({ q, asUser }) =>
      setRank(asUser, TEAM_LEADER_T1, await memberOf(q, RAIDER_T1), 'owner')
    );
    expect(toOwner).toMatch(/A rank is/);
    const elsewhere = await refusal(async ({ q, asUser }) =>
      setRank(asUser, TEAM_LEADER_T1, await memberOf(q, OFFICER_T2, 2), 'raider')
    );
    expect(elsewhere).toMatch(/not on this team/);
  });

  it('refuses an archived member', async () => {
    const message = await refusal(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await q('update public.team_members set archived_at = now() where id = $1', [raider]);
      await setRank(asUser, TEAM_LEADER_T1, raider, 'assistant');
    });
    expect(message).toMatch(/not on this team/);
  });

  it('writes no audit row when the rank is unchanged', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await setRank(asUser, TEAM_LEADER_T1, raider, 'raider');
      const audit = await q(`select 1 from public.audit_log where action = 'Team Rank Changed' and target_id = $1`, [
        raider
      ]);
      expect(audit.rows).toHaveLength(0);
    });
  });
});

describe('change_team_owner', () => {
  it('the guild Owner and an Admin hand the team over: the old Team Owner becomes an Officer', async () => {
    for (const uid of [TEAM_LEADER_T3, GUILD_OFFICER]) {
      await withTxn(async ({ q, asUser }) => {
        const oldOwner = await memberOf(q, TEAM_LEADER_T1);
        const officer = await memberOf(q, OFFICER_T1);
        await changeOwner(asUser, uid, officer);
        expect(await row(q, officer)).toEqual({ rank: 'owner', role: 'team_leader' });
        expect(await row(q, oldOwner)).toEqual({ rank: 'officer', role: 'officer' });
        const audit = await q(
          `select detail from public.audit_log where action = 'Team Owner Changed' and team_id = $1`,
          [T1]
        );
        expect(audit.rows[0].detail).toEqual({ from_team_member_id: oldOwner, to_old_rank: 'officer' });
      });
    }
  });

  it('goes to the person picked when another team leader is on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      // A second team leader: an Officer by rank, next in line for the pass-on trigger.
      const second = await memberOf(q, OFFICER_T1);
      await q(`update public.team_members set role = 'team_leader' where id = $1`, [second]);
      expect((await row(q, second)).rank).toBe('officer');
      const raider = await memberOf(q, RAIDER_T1);
      await changeOwner(asUser, GUILD_OFFICER, raider);
      expect((await row(q, raider)).rank).toBe('owner');
      expect((await row(q, second)).rank).toBe('officer');
      const owners = await q(
        `select id from public.team_members where team_id = $1 and rank = 'owner' and archived_at is null`,
        [T1]
      );
      expect(owners.rows.map((r) => r.id)).toEqual([raider]);
    });
  });

  it('gives an ownerless team an owner', async () => {
    await withTxn(async ({ q, asUser }) => {
      const oldOwner = await memberOf(q, TEAM_LEADER_T1);
      await q('update public.team_members set archived_at = now() where id = $1', [oldOwner]);
      const raider = await memberOf(q, RAIDER_T1);
      await changeOwner(asUser, GUILD_OFFICER, raider);
      expect((await row(q, raider)).rank).toBe('owner');
    });
  });

  it('refuses the Team Owner, an Officer, a Raider, a site admin and an Admin the grid has switched off', async () => {
    for (const uid of [TEAM_LEADER_T1, OFFICER_T1, RAIDER_T1, SITE_ADMIN, TEAM_LEADER_T2]) {
      const message = await refusal(async ({ q, asUser }) => changeOwner(asUser, uid, await memberOf(q, OFFICER_T1)));
      expect(message, uid).toMatch(/Not authorized/);
    }
    const off = await refusal(async ({ q, asUser }) => {
      await q(
        `delete from public.guild_rank_permissions
          where rank = 'admin' and permission = 'change_team_owner'
            and guild_id = (select guild_id from public.teams where id = $1)`,
        [T1]
      );
      await changeOwner(asUser, GUILD_OFFICER, await memberOf(q, OFFICER_T1));
    });
    expect(off).toMatch(/Not authorized/);
  });

  it('refuses someone not on the team, already the owner, archived, or never signed in', async () => {
    const elsewhere = await refusal(async ({ q, asUser }) =>
      changeOwner(asUser, GUILD_OFFICER, await memberOf(q, OFFICER_T2, 2))
    );
    expect(elsewhere).toMatch(/not on this team/);
    const already = await refusal(async ({ q, asUser }) =>
      changeOwner(asUser, GUILD_OFFICER, await memberOf(q, TEAM_LEADER_T1))
    );
    expect(already).toMatch(/already the Team Owner/);
    const archived = await refusal(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await q('update public.team_members set archived_at = now() where id = $1', [raider]);
      await changeOwner(asUser, GUILD_OFFICER, raider);
    });
    expect(archived).toMatch(/not on this team/);
    const listed = await refusal(async ({ q, asUser }) => {
      const member = (
        await q(
          `insert into public.team_members (team_id, discord_id, role)
           values ($1, 'discord-never-signed-in', 'raider') returning id`,
          [T1]
        )
      ).rows[0].id;
      await changeOwner(asUser, GUILD_OFFICER, member);
    });
    expect(listed).toMatch(/not signed in/);
  });

  it('refuses an archived team', async () => {
    const message = await refusal(async ({ q, asUser }) => {
      await q('update public.teams set archived_at = now() where id = $1', [T1]);
      await changeOwner(asUser, GUILD_OFFICER, await memberOf(q, OFFICER_T1));
    });
    expect(message).toMatch(/archived/);
  });
});

describe('team_member_ranks', () => {
  it('lists current members, the owner first, for the guild Owner and an Admin', async () => {
    for (const uid of [TEAM_LEADER_T3, GUILD_OFFICER]) {
      await withTxn(async ({ q, asUser }) => {
        const rows = (await asUser(uid, 'select * from public.team_member_ranks($1)', [T1])).rows;
        expect(rows[0]).toMatchObject({ team_member_id: await memberOf(q, TEAM_LEADER_T1), rank: 'owner' });
        expect(rows.map((r) => r.team_member_id)).toContain(await memberOf(q, RAIDER_T1));
        expect(rows.every((r) => typeof r.display_name === 'string' && r.display_name !== '')).toBe(true);
      });
    }
  });

  it('names people, says who has signed in, and leaves out the archived and other teams', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await memberOf(q, RAIDER_T1);
      await q("insert into public.names (team_id, label, team_member_id) values ($1, 'Katorri', $2)", [T1, raider]);
      const officer = await memberOf(q, OFFICER_T1);
      await q('update public.team_members set archived_at = now() where id = $1', [officer]);
      const listed = (
        await q(
          `insert into public.team_members (team_id, discord_id, role)
           values ($1, 'discord-never-signed-in', 'raider') returning id`,
          [T1]
        )
      ).rows[0].id;
      const rows = (await asUser(GUILD_OFFICER, 'select * from public.team_member_ranks($1)', [T1])).rows;
      const ids = rows.map((r) => r.team_member_id);
      expect(rows.find((r) => r.team_member_id === raider)).toMatchObject({ display_name: 'Katorri', signed_in: true });
      expect(rows.find((r) => r.team_member_id === listed)).toMatchObject({
        display_name: 'Unnamed',
        signed_in: false
      });
      expect(ids).not.toContain(officer);
      expect(ids).not.toContain(await memberOf(q, OFFICER_T2, 2));
    });
  });

  it('the Team Owner and an Officer read it, is_you marking the caller', async () => {
    for (const uid of [TEAM_LEADER_T1, OFFICER_T1]) {
      await withTxn(async ({ q, asUser }) => {
        const rows = (await asUser(uid, 'select * from public.team_member_ranks($1)', [T1])).rows;
        expect(rows.filter((r) => r.is_you).map((r) => r.team_member_id)).toEqual([await memberOf(q, uid)]);
      });
    }
  });

  it('refuses a Raider, an officer of another team and a site admin', async () => {
    for (const uid of [RAIDER_T1, OFFICER_T2, SITE_ADMIN]) {
      const message = await refusal(async ({ asUser }) =>
        asUser(uid, 'select * from public.team_member_ranks($1)', [T1])
      );
      expect(message, uid).toMatch(/Not authorized/);
    }
  });
});

describe('signed out', () => {
  const CALLS = [
    ['set_team_rank', `select public.set_team_rank(${T1}, 1, 'raider')`],
    ['change_team_owner', `select public.change_team_owner(${T1}, 1)`],
    ['team_member_ranks', `select * from public.team_member_ranks(${T1})`]
  ];

  it('refuses the anon role at the grant', async () => {
    for (const [name, call] of CALLS) {
      const message = await refusal(async ({ asAnon }) => asAnon(call));
      expect(message, name).toMatch(/permission denied/);
    }
  });

  it('refuses a signed-in role with no user', async () => {
    for (const [name, call] of CALLS) {
      const message = await refusal(async ({ asRole }) => asRole('authenticated', null)(call));
      expect(message, name).toMatch(/Not signed in/);
    }
  });
});
