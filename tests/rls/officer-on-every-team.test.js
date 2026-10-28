// #1647 part 2: inside a team someone is not on, a guild rank alone gives
// nothing. "Officer on every team" acts as an Officer on every team in the
// guild; "See every team, read-only" reads them and writes nothing. Until
// cutover the current site's Grant and Revoke Guild Officer switch the first
// on and off. Every case runs in a rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedMember,
  seedPlayer,
  seedSignup,
  RLS_DENIED,
  GUILD_OFFICER,
  SITE_ADMIN,
  setOfficerOnEveryTeam
} from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const HELLFIRE = 2;

const switches = async (q, discordId) =>
  (
    await q(
      `select r.rank, r.officer_on_every_team as officer, r.sees_every_team as sees
         from public.guild_ranks r
        where r.guild_id = ${WGA} and r.person_id = public.person_for_discord_id($1)`,
      [discordId]
    )
  ).rows[0];

// Hellfire's officer-only rows: an RSVP, an officer note and an invite link.
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
  return player;
}

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

// A second guild with one team, and someone there holding one of the
// switches, or (column null) its Owner with both off.
async function otherGuildSwitch(q, column) {
  const guild = (await q("insert into public.guilds (name) values ('Other Guild') returning id")).rows[0].id;
  const team = (await q("insert into public.teams (name, guild_id) values ('Other Team', $1) returning id", [guild]))
    .rows[0].id;
  const who = await seedMember(q, { teamId: team });
  await q(
    column
      ? `insert into public.guild_ranks (guild_id, person_id, rank, ${column})
         values ($1, public.person_for_discord_id($2), 'admin', true)`
      : `insert into public.guild_ranks (guild_id, person_id, rank)
         values ($1, public.person_for_discord_id($2), 'owner')`,
    [guild, who.discordId]
  );
  return who;
}

const reads = async (asUser, uid) => ({
  rsvps: (await asUser(uid, 'select 1 from public.raid_rsvps where team_id = $1', [HELLFIRE])).rows.length,
  notes: (await asUser(uid, 'select 1 from public.player_officer_notes where team_id = $1', [HELLFIRE])).rows.length,
  members: (await asUser(uid, 'select 1 from public.team_members where team_id = $1', [HELLFIRE])).rows.length
});

describe('the current site keeps a guild officer an officer on every team', () => {
  it('Grant Guild Officer makes an Admin with Officer on every team, and Revoke takes both away', async () => {
    await withTxn(async ({ q, asUser }) => {
      const who = await seedMember(q, { teamId: 1 });
      await asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1)', [who.discordId]);
      expect(await switches(q, who.discordId)).toEqual({ rank: 'admin', officer: true, sees: false });
      await asUser(who.uid, "select public.officer_set_rsvp($1, $2, current_date, 'Late', 'probe')", [
        HELLFIRE,
        await seedPlayer(q, { teamId: HELLFIRE })
      ]);

      await asUser(SITE_ADMIN, 'select public.admin_revoke_guild_officer($1)', [who.discordId]);
      expect(await switches(q, who.discordId)).toEqual({ rank: 'member', officer: false, sees: false });
      await expect(
        asUser(who.uid, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [HELLFIRE])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('a rank changed on the new side leaves the switch as it was', async () => {
    await withTxn(async ({ q }) => {
      const who = await seedMember(q, { teamId: 1 });
      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank) values (${WGA}, public.person_for_discord_id($1), 'admin')`,
        [who.discordId]
      );
      expect(await switches(q, who.discordId)).toEqual({ rank: 'admin', officer: false, sees: false });
    });
  });
});

describe('Officer on every team', () => {
  it('acts as an Officer on a team they are not on, loot included', async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      expect(await reads(asUser, GUILD_OFFICER)).toMatchObject({ rsvps: 1, notes: 1 });
      await asUser(GUILD_OFFICER, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [
        HELLFIRE
      ]);
      await asUser(GUILD_OFFICER, "select public.set_team_officer_bios($1, '[]'::jsonb)", [HELLFIRE]);
      await asUser(GUILD_OFFICER, "select public.write_audit_log($1, 'Probe 1647')", [HELLFIRE]);
    });
  });

  it('switched off, a guild Admin sees and changes nothing inside the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      await setOfficerOnEveryTeam(q, GUILD_OFFICER, false);
      expect(await reads(asUser, GUILD_OFFICER)).toEqual({ rsvps: 0, notes: 0, members: 0 });
      await expect(
        asUser(GUILD_OFFICER, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [
          HELLFIRE
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(
        asUser(GUILD_OFFICER, "select public.set_team_officer_bios($1, '[]'::jsonb)", [HELLFIRE])
      ).rejects.toThrow(/Not authorized/);
      await expect(
        asUser(GUILD_OFFICER, "select public.write_audit_log($1, 'Probe 1647')", [HELLFIRE])
      ).rejects.toThrow(/Not authorized/);
      await expect(asUser(GUILD_OFFICER, 'select * from public.team_unnamed_members($1)', [HELLFIRE])).rejects.toThrow(
        /Not authorized/
      );
      const both = await onBothTeams(q);
      expect(await alsoOn(asUser, GUILD_OFFICER)).not.toContain(both);
      // Still an Admin of the guild: the guild's own checks pass.
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, true)', [HELLFIRE]);
    });
  });
});

describe("the guild's Owner", () => {
  // Kat, 2026-10-28: the Owner always counts as Officer on every team, with
  // the switch itself left off.
  it('acts as an Officer on every team in the guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const who = await seedMember(q, { teamId: 1 });
      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank) values (${WGA}, public.person_for_discord_id($1), 'owner')`,
        [who.discordId]
      );
      expect(await switches(q, who.discordId)).toEqual({ rank: 'owner', officer: false, sees: false });
      expect(await reads(asUser, who.uid)).toMatchObject({ rsvps: 1, notes: 1 });
      await asUser(who.uid, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [
        HELLFIRE
      ]);
      await asUser(who.uid, "select public.set_team_officer_bios($1, '[]'::jsonb)", [HELLFIRE]);
    });
  });
});

describe('See every team, read-only', () => {
  // A raider on Phoenix with only the reading switch on.
  async function viewer(q) {
    const who = await seedMember(q, { teamId: 1 });
    await q(
      `insert into public.guild_ranks (guild_id, person_id, rank, sees_every_team)
       values (${WGA}, public.person_for_discord_id($1), 'member', true)`,
      [who.discordId]
    );
    return who;
  }

  it("reads another team's officer pages", async () => {
    await withTxn(async ({ q, asUser }) => {
      await hellfireRows(q);
      const who = await viewer(q);
      const seen = await reads(asUser, who.uid);
      expect(seen.rsvps).toBe(1);
      expect(seen.notes).toBe(1);
      expect(seen.members).toBeGreaterThan(0);
      await asUser(who.uid, 'select * from public.team_rsvp_answers($1, current_date, current_date)', [HELLFIRE]);
      const both = await onBothTeams(q);
      expect(await alsoOn(asUser, who.uid)).toContain(both);
      // The Signups tab and the priority list's dismissals (fresh review).
      const signup = await seedSignup(q, { teamId: HELLFIRE });
      expect((await asUser(who.uid, 'select id from public.season_signups where id = $1', [signup])).rows).toHaveLength(
        1
      );
      await q(
        `insert into public.priority_stale_dismissals (team_id, season, item_id)
         values ($1, 'seed-season', (select min(id) from public.items))`,
        [HELLFIRE]
      );
      expect(
        (await asUser(who.uid, 'select 1 from public.priority_stale_dismissals where team_id = $1', [HELLFIRE])).rows
      ).toHaveLength(1);
      const perms = await asUser(
        who.uid,
        `select public.has_team_permission($1, 'view_loot') as loot, public.has_team_permission($1, 'edit_roster') as roster`,
        [HELLFIRE]
      );
      expect(perms.rows[0]).toEqual({ loot: true, roster: false });
    });
  });

  it('writes nothing, and does not read the invite links', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await hellfireRows(q);
      await q(
        "insert into public.team_invite_links (team_id, code) values ($1, 'hellfire-probe1647') on conflict do nothing",
        [HELLFIRE]
      );
      const who = await viewer(q);
      await expect(
        asUser(who.uid, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [HELLFIRE])
      ).rejects.toMatchObject({ code: RLS_DENIED });
      const edited = await asUser(
        who.uid,
        "update public.player_officer_notes set officer_notes = 'x' where player_id = $1",
        [player]
      );
      expect(edited.rowCount).toBe(0);
      await expect(
        asUser(who.uid, "select public.officer_set_rsvp($1, $2, current_date, 'Late', 'probe')", [HELLFIRE, player])
      ).rejects.toThrow(/Not authorized/);
      await expect(asUser(who.uid, "select public.write_audit_log($1, 'Probe 1647')", [HELLFIRE])).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(who.uid, 'select * from public.team_battlenet_connections($1)', [HELLFIRE])).rejects.toThrow(
        /Not authorized/
      );
      expect(
        (await asUser(who.uid, 'select 1 from public.team_invite_links where team_id = $1', [HELLFIRE])).rows
      ).toEqual([]);
    });
  });
});

describe('a switch in one guild gives nothing in another (CodeRabbit)', () => {
  for (const column of ['officer_on_every_team', 'sees_every_team', null]) {
    it(`${column ?? 'the Owner'} in another guild reads and writes nothing on Hellfire`, async () => {
      await withTxn(async ({ q, asUser }) => {
        await hellfireRows(q);
        const who = await otherGuildSwitch(q, column);
        expect(await reads(asUser, who.uid)).toEqual({ rsvps: 0, notes: 0, members: 0 });
        await expect(
          asUser(who.uid, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Illidan')", [HELLFIRE])
        ).rejects.toMatchObject({ code: RLS_DENIED });
      });
    });
  }

  it('signed out, no officer note reads', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await hellfireRows(q);
      expect((await asAnon('select 1 from public.player_officer_notes')).rows).toEqual([]);
    });
  });
});
