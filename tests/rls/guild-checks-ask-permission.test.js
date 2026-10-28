// #1647: the guild-level checks ask the guild grid's permission, in the guild
// they act on. We Go Again's guild officer (GUILD_OFFICER, a raider on team 1)
// is an Admin since #1645; a Team Lead is made per case. The bio cards and
// the BoE payout settings are the guild's own.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedMember, insertDiscordUser, GUILD_OFFICER, RAIDER_T1, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const HELLFIRE = 2;

const wgaId = async (q) => (await q(`select ${WGA} as id`)).rows[0].id;

// A raider on Phoenix whom the guild has made a Team Lead.
async function teamLead(q) {
  const lead = await seedMember(q, { teamId: 1 });
  await q(
    `insert into public.guild_ranks (guild_id, person_id, rank)
     values (${WGA}, public.person_for_discord_id($1), 'team_lead')`,
    [lead.discordId]
  );
  const personId = (await q('select public.person_for_discord_id($1) as id', [lead.discordId])).rows[0].id;
  return { ...lead, personId };
}

// A second guild with one team and its own guild officer, and optionally a
// BoE manager of that guild alone.
async function otherGuild(q, { boeManager = false } = {}) {
  const guild = (
    await q("insert into public.guilds (name, region, realm) values ('Other Guild', 'us', 'Stormrage') returning id")
  ).rows[0].id;
  const grant = async (type) => {
    const uid = randomUUID();
    const discordId = `discord-1647-${uid}`;
    await insertDiscordUser(q, uid, discordId);
    await q(
      'insert into public.guild_grants (person_id, guild_id, grant_type) values (public.person_for_discord_id($1), $2, $3)',
      [discordId, guild, type]
    );
    return uid;
  };
  return { guild, officer: await grant('guild_officer'), manager: boeManager ? await grant('boe_manager') : null };
}

describe('teams', () => {
  it('a Team Lead creates a team and owns it, and cannot rename or archive another', async () => {
    await withTxn(async ({ q, asUser }) => {
      const lead = await teamLead(q);
      const made = (await asUser(lead.uid, `select team_id from public.create_team(${WGA}, 'Lead Team')`)).rows[0];
      const rank = await q('select rank from public.team_members where team_id = $1 and person_id = $2', [
        made.team_id,
        lead.personId
      ]);
      expect(rank.rows).toEqual([{ rank: 'owner' }]);

      await expect(asUser(lead.uid, "select public.update_team(2, 'Renamed', 'renamed')")).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(lead.uid, 'select public.set_team_archived(2, true)')).rejects.toThrow(/Not authorized/);
      await expect(asUser(lead.uid, 'select public.set_team_unlisted(2, true)')).rejects.toThrow(/Not authorized/);
    });
  });

  it('a plain member cannot create a team', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(RAIDER_T1, `select * from public.create_team(${WGA}, 'Nope')`)).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('an Admin renames, unlists and archives a team they hold no officer rank on, and it is audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(GUILD_OFFICER, "select public.update_team(2, 'Hellfire Renamed', 'hellfire-renamed')");
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted(2, true)');
      await asUser(GUILD_OFFICER, 'select public.set_team_archived(2, true)');
      const log = await q(
        `select action from public.audit_log
          where team_id = 2 and actor_id = $1 and target_type = 'teams' order by id`,
        [GUILD_OFFICER]
      );
      expect(log.rows.map((r) => r.action)).toEqual(['Team Updated', 'Team Unlisted', 'Team Archived']);
    });
  });

  it("another guild's Admin acts on none of We Go Again's teams", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { officer } = await otherGuild(q);
      await expect(asUser(officer, `select * from public.create_team(${WGA}, 'Nope')`)).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(officer, 'select public.set_team_archived(2, true)')).rejects.toThrow(/Not authorized/);
    });
  });
});

describe('bio cards', () => {
  const KAT = { name: 'Kat', title: 'Loot officer' };
  const save = (asUser, uid, bios, guild = WGA) =>
    asUser(uid, `select public.set_guild_officer_bios($1::jsonb, ${guild}) as v`, [JSON.stringify(bios)]);
  const stored = async (q, guild = WGA) =>
    (await q(`select officer_bios from public.guilds where id = ${guild}`)).rows[0].officer_bios;

  it("an Admin saves any card, onto their own guild's row only", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { guild } = await otherGuild(q);
      await save(asUser, GUILD_OFFICER, [KAT]);
      expect(await stored(q)).toEqual([KAT]);
      expect(await stored(q, guild)).toEqual([]);
      await expect(save(asUser, GUILD_OFFICER, [KAT], guild)).rejects.toThrow(/Not authorized/);
    });
  });

  it('a Team Lead adds, edits and removes their own card, and touches no one else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, GUILD_OFFICER, [KAT]);
      const lead = await teamLead(q);
      const own = { name: 'Lead', personId: lead.personId };

      await save(asUser, lead.uid, [KAT, own]);
      await save(asUser, lead.uid, [KAT, { ...own, title: 'Raid lead' }]);
      expect(await stored(q)).toEqual([KAT, { ...own, title: 'Raid lead' }]);

      // Someone else's card changed, removed, or added in their name.
      await expect(save(asUser, lead.uid, [{ ...KAT, title: 'Nope' }, own])).rejects.toThrow(/Not authorized/);
      await expect(save(asUser, lead.uid, [own])).rejects.toThrow(/Not authorized/);
      await expect(save(asUser, lead.uid, [KAT, own, { name: 'Other', personId: lead.personId + 1 }])).rejects.toThrow(
        /Not authorized/
      );
      await expect(save(asUser, lead.uid, [KAT, own, { name: 'Unowned' }])).rejects.toThrow(/Not authorized/);

      await save(asUser, lead.uid, [KAT]);
      expect(await stored(q)).toEqual([KAT]);
    });
  });

  it('a plain member saves nothing, not even a card of their own', async () => {
    await withTxn(async ({ q, asUser }) => {
      const personId = (await q('select person_id from public.team_members where auth_user_id = $1', [RAIDER_T1]))
        .rows[0].person_id;
      await expect(save(asUser, RAIDER_T1, [{ name: 'Me', personId }])).rejects.toThrow(/Not authorized/);
    });
  });

  it('refuses a list that is not a list', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, SITE_ADMIN, { name: 'Kat' })).rejects.toThrow(/must be a list/);
    });
  });
});

describe('BoE', () => {
  it("another guild's BoE manager records nothing on We Go Again's finds, and reads none", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { manager } = await otherGuild(q, { boeManager: true });
      await expect(asUser(manager, 'select public.boe_record_listing(1, 50000)')).rejects.toThrow(/Not authorized/);
      expect((await asUser(manager, 'select id from public.boe_items')).rows).toEqual([]);
      expect((await asUser(manager, 'select public.can_settle_boe(1) as v')).rows[0].v).toBe(false);
    });
  });

  it("an Admin records a sale on any team's find, priced with the guild's own payout settings", async () => {
    await withTxn(async ({ q, asUser }) => {
      const wga = await wgaId(q);
      await asUser(GUILD_OFFICER, 'select public.set_boe_payout_settings(30000, 100000, $1)', [wga]);
      const { guild } = await otherGuild(q);
      await q('update public.guilds set boe_payout_floor = 1 where id = $1', [guild]);

      await asUser(GUILD_OFFICER, 'select * from public.boe_record_sale(1, 100000)');
      const sold = await q('select payout_floor, finder_payout from public.boe_items where id = 1');
      expect(sold.rows[0]).toEqual({ payout_floor: '30000', finder_payout: '30000' });

      // pay_any_boe: a team they hold no officer rank on.
      expect((await asUser(GUILD_OFFICER, 'select public.can_settle_boe($1) as v', [HELLFIRE])).rows[0].v).toBe(true);
    });
  });

  it("payout settings are an Admin's in their own guild, not a Team Lead's or another guild's", async () => {
    await withTxn(async ({ q, asUser }) => {
      const wga = await wgaId(q);
      const lead = await teamLead(q);
      const { officer } = await otherGuild(q);
      const set = (uid) => asUser(uid, 'select public.set_boe_payout_settings(30000, 100000, $1)', [wga]);
      await expect(set(lead.uid)).rejects.toThrow(/Not authorized/);
      await expect(set(officer)).rejects.toThrow(/Not authorized/);
      await expect(set(RAIDER_T1)).rejects.toThrow(/Not authorized/);
      expect((await asUser(lead.uid, 'select public.can_settle_boe(1) as v')).rows[0].v).toBe(false);
    });
  });
});

describe('the guild audit log', () => {
  it("an Admin reads every team's log in their own guild; another guild's Admin and a Team Lead do not", async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.audit_log (team_id, actor_id, action) values ($1, $2, 'Probe 1647')", [
        HELLFIRE,
        SITE_ADMIN
      ]);
      const probe = (uid) => asUser(uid, "select id from public.audit_log where action = 'Probe 1647'");
      expect((await probe(GUILD_OFFICER)).rows).toHaveLength(1);
      const { officer } = await otherGuild(q);
      expect((await probe(officer)).rows).toEqual([]);
      const lead = await teamLead(q);
      expect((await probe(lead.uid)).rows).toEqual([]);
    });
  });
});
