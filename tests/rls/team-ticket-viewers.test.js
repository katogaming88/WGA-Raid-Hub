// #1814: who a team's recruiting tickets would add, with whether each has a
// linked Discord, for the Recruiting settings page. Team 3 (Immolation): its
// Owner TEAM_LEADER_T3 is also the guild's Owner, OFFICER_T3 an officer,
// RAIDER_T3 a raider; GUILD_OFFICER is the guild's Admin.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  OFFICER_T3,
  RAIDER_T3,
  TEAM_LEADER_T3,
  GUILD_OFFICER,
  SITE_ADMIN
} from './helpers.js';

afterAll(() => pool.end());

const viewers = async (asUser, uid = TEAM_LEADER_T3) =>
  (await asUser(uid, 'select * from public.team_ticket_viewers(3)')).rows;
const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;
const groups = (rows) => rows.map((r) => r.viewer_group);

async function lockTeam(q) {
  await q('select 1 from public.teams where id = 3 for update');
}

describe('team_ticket_viewers()', () => {
  it('follows the team’s settings: officers, then assistants, then the guild’s Owner and Admins, each once', async () => {
    await withTxn(async ({ q, asUser }) => {
      await lockTeam(q);
      await q(
        'update public.team_recruiting set visible_to_team_officers = true, visible_to_team_assistants = false, visible_to_guild_admins = false where team_id = 3'
      );
      expect(groups(await viewers(asUser))).toEqual(['officer', 'officer']);

      const raider = await personOf(q, RAIDER_T3);
      await q("update public.team_members set rank = 'assistant' where team_id = 3 and person_id = $1", [raider]);
      await q('update public.team_recruiting set visible_to_team_assistants = true where team_id = 3');
      expect(groups(await viewers(asUser))).toEqual(['officer', 'officer', 'assistant']);

      // The guild's Owner is already there as the team's Owner: listed once.
      await q('update public.team_recruiting set visible_to_guild_admins = true where team_id = 3');
      expect(groups(await viewers(asUser))).toEqual(['officer', 'officer', 'assistant', 'guild_admin']);

      await q(
        'update public.team_recruiting set visible_to_team_officers = false, visible_to_team_assistants = false where team_id = 3'
      );
      expect(groups(await viewers(asUser))).toEqual(['guild_admin', 'guild_admin']);
    });
  });

  it('says who has no linked Discord, and nothing else about their Discord', async () => {
    await withTxn(async ({ q, asUser }) => {
      await lockTeam(q);
      await q(
        'update public.team_recruiting set visible_to_team_officers = true, visible_to_team_assistants = false, visible_to_guild_admins = false where team_id = 3'
      );
      expect((await viewers(asUser)).every((r) => r.discord_linked)).toBe(true);
      await q('update public.people set discord_id = null where id = $1', [await personOf(q, OFFICER_T3)]);
      const rows = await viewers(asUser);
      expect(rows.filter((r) => !r.discord_linked)).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(['discord_linked', 'display_name', 'viewer_group']);
      expect(JSON.stringify(rows)).not.toMatch(/discord-/);
    });
  });

  it('names a guild Admin who is on the team the way the team does', async () => {
    await withTxn(async ({ q, asUser }) => {
      await lockTeam(q);
      await q(
        'update public.team_recruiting set visible_to_team_officers = false, visible_to_team_assistants = false, visible_to_guild_admins = true where team_id = 3'
      );
      // The guild's Owner is Immolation's Owner: as a guild Admin here, still
      // named as the team names them.
      const asTeam = (
        await q(
          'select public.team_member_name(3, m.id) as n from public.team_members m where m.team_id = 3 and m.person_id = $1 and m.archived_at is null',
          [await personOf(q, TEAM_LEADER_T3)]
        )
      ).rows[0].n;
      expect((await viewers(asUser)).map((r) => r.display_name)).toContain(asTeam);
    });
  });

  it('leaves out a member who left the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await lockTeam(q);
      await q('update public.team_recruiting set visible_to_team_officers = true where team_id = 3');
      const before = (await viewers(asUser)).length;
      await q('update public.team_members set archived_at = now() where team_id = 3 and person_id = $1', [
        await personOf(q, OFFICER_T3)
      ]);
      expect((await viewers(asUser)).length).toBe(before - 1);
    });
  });

  it('answers the team’s recruiting editors and a site admin, and refuses everyone else', async () => {
    await withTxn(async ({ asUser }) => {
      expect((await viewers(asUser, TEAM_LEADER_T3)).length).toBeGreaterThan(0);
      expect((await viewers(asUser, SITE_ADMIN)).length).toBeGreaterThan(0);
      await expect(viewers(asUser, RAIDER_T3)).rejects.toThrow('Not authorized');
      await expect(viewers(asUser, OFFICER_T1)).rejects.toThrow('Not authorized');
      await expect(viewers(asUser, GUILD_OFFICER)).rejects.toThrow('Not authorized');
      await expect(viewers(asUser, null)).rejects.toThrow('Not signed in');
    });
  });
});
