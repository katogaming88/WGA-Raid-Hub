// #1647 part 2: inside a team someone is not on, a guild rank only reads.
// The guild grid's "See every team (read-only)" (view_every_team, Admins by
// default, the Owner as always) reads what an Officer reads on every team in
// the guild and changes nothing; team powers come from a team rank (Kat,
// 2026-10-28). We Go Again's guild officer (GUILD_OFFICER, a raider on
// Phoenix) is an Admin. Every case runs in a rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedMember, seedPlayer, seedSignup, RLS_DENIED, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const HELLFIRE = 2;

// Hellfire's officer-only rows: an RSVP, an officer note, a pending signup,
// a priority dismissal and an invite link. Returns the player.
async function hellfireRows(q) {
  const player = await seedPlayer(q, { teamId: HELLFIRE });
  await q(
    "insert into public.raid_rsvps (team_id, player_id, raid_date, status) values ($1, $2, current_date, 'Late')",
    [HELLFIRE, player]
  );
  await q("insert into public.player_officer_notes (player_id, team_id, officer_notes) values ($1, $2, 'note')", [
    player,
    HELLFIRE
  ]);
  await seedSignup(q, { teamId: HELLFIRE });
  await q(
    `insert into public.priority_stale_dismissals (team_id, season, item_id)
     values ($1, 'seed-season', (select min(id) from public.items))`,
    [HELLFIRE]
  );
  await q(
    "insert into public.team_invite_links (team_id, code) values ($1, 'hellfire-probe1647') on conflict do nothing",
    [HELLFIRE]
  );
  return player;
}

const count = async (asUser, uid, table) =>
  (await asUser(uid, `select 1 from public.${table} where team_id = $1`, [HELLFIRE])).rows.length;

const reads = async (asUser, uid) => ({
  rsvps: await count(asUser, uid, 'raid_rsvps'),
  notes: await count(asUser, uid, 'player_officer_notes'),
  members: await count(asUser, uid, 'team_members'),
  signups: await count(asUser, uid, 'season_signups'),
  dismissals: await count(asUser, uid, 'priority_stale_dismissals')
});
const NOTHING = { rsvps: 0, notes: 0, members: 0, signups: 0, dismissals: 0 };

// Someone on both Hellfire and Phoenix, with a character on each, so
// Hellfire's "Also on" has a row to show.
async function onBothTeams(q) {
  const who = await seedMember(q, { teamId: HELLFIRE });
  const phoenix = (
    await q("insert into public.team_members (team_id, discord_id, role) values (1, $1, 'raider') returning id", [
      who.discordId
    ])
  ).rows[0].id;
  const player = await seedPlayer(q, { teamId: HELLFIRE, memberId: who.memberId });
  await seedPlayer(q, { teamId: 1, memberId: phoenix });
  return player;
}

const alsoOn = async (asUser, uid) =>
  (await asUser(uid, 'select player_id from public.also_on_teams($1)', [HELLFIRE])).rows.map((r) => r.player_id);

// A Phoenix raider with this guild rank in We Go Again.
async function ranked(q, rank) {
  const who = await seedMember(q, { teamId: 1 });
  await q(
    `insert into public.guild_ranks (guild_id, person_id, rank) values (${WGA}, public.person_for_discord_id($1), $2)`,
    [who.discordId, rank]
  );
  return who;
}

describe('See every team (read-only)', () => {
  it("lets an Admin read another team's officer pages", async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const seen = await reads(asUser, GUILD_OFFICER);
      expect(seen).toMatchObject({ rsvps: 1, notes: 1, dismissals: 1 });
      expect(seen.signups).toBeGreaterThan(0);
      expect(seen.members).toBeGreaterThan(0);
      const both = await onBothTeams(q);
      expect(await alsoOn(asUser, GUILD_OFFICER)).toContain(both);
      await asUser(GUILD_OFFICER, 'select * from public.team_rsvp_answers($1, current_date, current_date)', [HELLFIRE]);
      const perms = await asUser(
        GUILD_OFFICER,
        `select public.has_team_permission($1, 'view_loot') as loot, public.has_team_permission($1, 'edit_roster') as roster`,
        [HELLFIRE]
      );
      expect(perms.rows[0]).toEqual({ loot: true, roster: false });
    });
  });

  it('writes nothing, and does not read the invite link', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await hellfireRows(q);
      await expect(
        asUser(GUILD_OFFICER, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [
          HELLFIRE
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      const edited = await asUser(
        GUILD_OFFICER,
        "update public.player_officer_notes set officer_notes = 'x' where player_id = $1",
        [player]
      );
      expect(edited.rowCount).toBe(0);
      for (const sql of [
        "select public.officer_set_rsvp($1, $2, current_date, 'Late', 'probe')",
        "select public.set_team_officer_bios($1, '[]'::jsonb)",
        "select public.write_audit_log($1, 'Probe 1647')",
        'select * from public.team_battlenet_connections($1)',
        'select * from public.team_unnamed_members($1)'
      ]) {
        const params = sql.includes('$2') ? [HELLFIRE, player] : [HELLFIRE];
        await expect(asUser(GUILD_OFFICER, sql, params)).rejects.toThrow(/Not authorized/);
      }
      expect(await count(asUser, GUILD_OFFICER, 'team_invite_links')).toBe(0);
    });
  });

  it('reads for the Owner too, and not for a Team Lead or a Member', async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const owner = await ranked(q, 'owner');
      expect(await reads(asUser, owner.uid)).toMatchObject({ rsvps: 1, notes: 1 });
      for (const rank of ['team_lead', 'member']) {
        const who = await ranked(q, rank);
        expect(await reads(asUser, who.uid)).toEqual(NOTHING);
      }
    });
  });

  it('follows the guild grid: switched off for Admins, an Admin reads nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      await q(
        `delete from public.guild_rank_permissions where guild_id = ${WGA} and rank = 'admin' and permission = 'view_every_team'`
      );
      expect(await reads(asUser, GUILD_OFFICER)).toEqual(NOTHING);
      expect(await alsoOn(asUser, GUILD_OFFICER)).toEqual([]);
    });
  });

  it("gives nothing in another guild's teams", async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const guild = (await q("insert into public.guilds (name) values ('Other Guild') returning id")).rows[0].id;
      const team = (
        await q("insert into public.teams (name, guild_id) values ('Other Team', $1) returning id", [guild])
      ).rows[0].id;
      const who = await seedMember(q, { teamId: team });
      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank) values ($1, public.person_for_discord_id($2), 'owner')`,
        [guild, who.discordId]
      );
      expect(await reads(asUser, who.uid)).toEqual(NOTHING);
    });
  });

  it("the current site's Grant Guild Officer gives it, and Revoke takes it away", async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const who = await seedMember(q, { teamId: 1 });
      expect(await reads(asUser, who.uid)).toEqual(NOTHING);
      await asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1)', [who.discordId]);
      expect(await reads(asUser, who.uid)).toMatchObject({ rsvps: 1, notes: 1 });
      await asUser(SITE_ADMIN, 'select public.admin_revoke_guild_officer($1)', [who.discordId]);
      expect(await reads(asUser, who.uid)).toEqual(NOTHING);
    });
  });

  it('signed out, no officer note reads', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await hellfireRows(q);
      expect((await asAnon('select 1 from public.player_officer_notes')).rows).toEqual([]);
    });
  });
});
