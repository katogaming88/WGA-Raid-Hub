// #1650: the guild's Members tab. The seed makes TEAM_LEADER_T3 We Go Again's
// Owner and GUILD_OFFICER an Admin; RAIDER_T1 is a Member by being on Phoenix.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, insertDiscordUser, GUILD_OFFICER, RAIDER_T1, TEAM_LEADER_T3 } from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const OWNER = TEAM_LEADER_T3;

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;
const rankOf = async (q, personId) =>
  (await q(`select rank from public.guild_ranks where guild_id = ${WGA} and person_id = $1`, [personId])).rows[0]
    ?.rank ?? null;
const grantOf = async (q, personId) =>
  (
    await q(
      `select count(*)::int as n from public.guild_grants
        where guild_id = ${WGA} and person_id = $1 and grant_type = 'guild_officer'`,
      [personId]
    )
  ).rows[0].n;

describe('guild_members', () => {
  it('the Owner and an Admin read everyone with a rank, and is_you marks the caller', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await personOf(q, RAIDER_T1);
      await q(
        "insert into public.names (team_id, label, team_member_id) select 1, 'Katorri', id from public.team_members where team_id = 1 and person_id = $1",
        [raider]
      );
      for (const uid of [OWNER, GUILD_OFFICER]) {
        const rows = (await asUser(uid, `select * from public.guild_members(${WGA})`)).rows;
        const me = await personOf(q, uid);
        expect(rows.filter((r) => r.is_you).map((r) => r.person_id)).toEqual([me]);
        expect(rows[0].rank).toBe('owner');
        expect(rows.find((r) => r.person_id === raider)).toMatchObject({ rank: 'member', display_name: 'Katorri' });
      }
    });
  });

  // The current site's Revoke Guild Officer leaves a 'member' row behind.
  it('someone who left every team is out of the guild, a leftover member row or not', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await personOf(q, RAIDER_T1);
      await q(`insert into public.guild_ranks (guild_id, person_id, rank) values (${WGA}, $1, 'member')`, [raider]);
      await q('update public.team_members set archived_at = now() where person_id = $1', [raider]);

      const rows = (await asUser(OWNER, `select * from public.guild_members(${WGA})`)).rows;
      expect(rows.map((r) => r.person_id)).not.toContain(raider);
      await expect(asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [raider])).rejects.toThrow(
        /not in this guild/
      );
      await expect(asUser(OWNER, `select public.transfer_guild_ownership(${WGA}, $1)`, [raider])).rejects.toThrow(
        /not in this guild/
      );
    });
  });

  it('a Member and someone outside the guild are refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const outsider = randomUUID();
      await insertDiscordUser(q, outsider, `discord-1650-${outsider}`);
      for (const uid of [RAIDER_T1, outsider]) {
        await expect(asUser(uid, `select * from public.guild_members(${WGA})`)).rejects.toThrow(/Not authorized/);
      }
    });
  });
});

describe('set_guild_rank', () => {
  it('the Owner promotes a Member to Admin and back, the grant follows, and each is audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await personOf(q, RAIDER_T1);
      await asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [raider]);
      expect(await rankOf(q, raider)).toBe('admin');
      expect(await grantOf(q, raider)).toBe(1);

      await asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'member')`, [raider]);
      expect(await rankOf(q, raider)).toBe(null);
      expect(await grantOf(q, raider)).toBe(0);

      const log = await q(
        `select detail from public.audit_log
          where action = 'Guild Rank Changed' and actor_id = $1 order by id`,
        [OWNER]
      );
      expect(log.rows.map((r) => r.detail.to)).toEqual(['admin', 'member']);
    });
  });

  it('the Owner makes an Admin a Team Lead, and the grant goes', async () => {
    await withTxn(async ({ q, asUser }) => {
      const admin = await personOf(q, GUILD_OFFICER);
      await asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'team_lead')`, [admin]);
      expect(await rankOf(q, admin)).toBe('team_lead');
      expect(await grantOf(q, admin)).toBe(0);
    });
  });

  it('an Admin and a Member cannot change ranks', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await personOf(q, RAIDER_T1);
      const admin = await personOf(q, GUILD_OFFICER);
      await expect(
        asUser(GUILD_OFFICER, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [raider])
      ).rejects.toThrow(/Not authorized/);
      await expect(asUser(RAIDER_T1, `select public.set_guild_rank(${WGA}, $1, 'member')`, [admin])).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('the Owner cannot demote themself, name Owner as a rank, or rank someone outside the guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      const me = await personOf(q, OWNER);
      const raider = await personOf(q, RAIDER_T1);
      const outsider = randomUUID();
      await insertDiscordUser(q, outsider, `discord-1650-${outsider}`);
      await expect(asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [me])).rejects.toThrow(
        /Hand the guild to someone else first/
      );
      await expect(asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'owner')`, [raider])).rejects.toThrow(
        /Admin, Team Lead or Member/
      );
      await expect(
        asUser(OWNER, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [await personOf(q, outsider)])
      ).rejects.toThrow(/not in this guild/);
    });
  });
});

describe('transfer_guild_ownership', () => {
  it('the Owner hands the guild to a Member and becomes an Admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      const me = await personOf(q, OWNER);
      const raider = await personOf(q, RAIDER_T1);
      await asUser(OWNER, `select public.transfer_guild_ownership(${WGA}, $1)`, [raider]);
      expect(await rankOf(q, raider)).toBe('owner');
      expect(await rankOf(q, me)).toBe('admin');
      expect(await grantOf(q, raider)).toBe(1);
      expect(await grantOf(q, me)).toBe(1);
      const log = await q(
        `select actor_id, detail from public.audit_log
          where action = 'Guild Ownership Transferred' and target_type = 'guilds' and target_id = ${WGA}`
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ actor_id: OWNER, detail: { from_person_id: me, to_person_id: raider } });

      // The old Owner is an Admin now, so cannot hand it back.
      await expect(asUser(OWNER, `select public.transfer_guild_ownership(${WGA}, $1)`, [me])).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('the Owner cannot hand the guild to someone who has never signed in', async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await personOf(q, RAIDER_T1);
      await q('update public.people set auth_user_id = null where id = $1', [raider]);
      await expect(asUser(OWNER, `select public.transfer_guild_ownership(${WGA}, $1)`, [raider])).rejects.toThrow(
        /not signed in yet/
      );
    });
  });

  it('an Admin cannot take the guild, and the Owner cannot hand it to themself', async () => {
    await withTxn(async ({ q, asUser }) => {
      const admin = await personOf(q, GUILD_OFFICER);
      const me = await personOf(q, OWNER);
      await expect(
        asUser(GUILD_OFFICER, `select public.transfer_guild_ownership(${WGA}, $1)`, [admin])
      ).rejects.toThrow(/Not authorized/);
      await expect(asUser(OWNER, `select public.transfer_guild_ownership(${WGA}, $1)`, [me])).rejects.toThrow(
        /someone else/
      );
    });
  });
});

describe('another guild', () => {
  it("another guild's Owner reads and changes nothing in We Go Again", async () => {
    await withTxn(async ({ q, asUser }) => {
      const guild = (
        await q(
          "insert into public.guilds (name, region, realm) values ('Other Guild', 'us', 'Stormrage') returning id"
        )
      ).rows[0].id;
      const owner = randomUUID();
      await insertDiscordUser(q, owner, `discord-1650-${owner}`);
      await q("insert into public.guild_ranks (guild_id, person_id, rank) values ($1, $2, 'owner')", [
        guild,
        await personOf(q, owner)
      ]);
      const raider = await personOf(q, RAIDER_T1);

      await expect(asUser(owner, `select * from public.guild_members(${WGA})`)).rejects.toThrow(/Not authorized/);
      await expect(asUser(owner, `select public.set_guild_rank(${WGA}, $1, 'admin')`, [raider])).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(owner, `select public.transfer_guild_ownership(${WGA}, $1)`, [raider])).rejects.toThrow(
        /Not authorized/
      );
    });
  });
});

describe('signed out', () => {
  it('none of the three runs', async () => {
    await withTxn(async ({ asAnon }) => {
      for (const sql of [
        `select * from public.guild_members(${WGA})`,
        `select public.set_guild_rank(${WGA}, 1, 'admin')`,
        `select public.transfer_guild_ownership(${WGA}, 1)`
      ]) {
        await expect(asAnon(sql)).rejects.toThrow();
      }
    });
  });
});
