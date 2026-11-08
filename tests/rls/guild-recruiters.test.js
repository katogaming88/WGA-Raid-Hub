// #1537: a guild's recruiters and their link codes. The seed makes
// TEAM_LEADER_T3 We Go Again's Owner and GUILD_OFFICER an Admin; RAIDER_T1 is
// a Member by being on Phoenix.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  GUILD_OFFICER,
  OFFICER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  TEAM_LEADER_T1,
  TEAM_LEADER_T3
} from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const OWNER = TEAM_LEADER_T3;

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;
const setRecruiter = async (asUser, uid, person, on) =>
  (await asUser(uid, `select public.set_guild_recruiter(${WGA}, $1, $2) as code`, [person, on])).rows[0].code;
const lookup = async (run, code, guild = 'wga') =>
  (await run('select public.recruiter_for_code($1, $2) as r', [guild, code])).rows[0].r;
const activeList = async (run) => (await run("select * from public.guild_active_recruiters('wga')")).rows;
const audits = async (q) =>
  (await q("select action, detail from public.audit_log where action like 'Recruiter %' order by id")).rows;

describe('guild recruiters', () => {
  it('an Admin switches a Member on: they get a code that names them, signed out too, and shows in the list', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const raider = await personOf(q, RAIDER_T1);
      await q(
        "insert into public.names (team_id, label, team_member_id) select 1, 'Katorri', id from public.team_members where team_id = 1 and person_id = $1",
        [raider]
      );
      const code = await setRecruiter(asUser, GUILD_OFFICER, raider, true);
      expect(code).toMatch(/^[a-z0-9]{8}$/);

      expect(await lookup(asAnon, code)).toEqual({ name: 'Katorri', active: true });
      expect(await lookup(asAnon, code.toUpperCase())).toEqual({ name: 'Katorri', active: true });
      expect(await activeList(asAnon)).toEqual([{ name: 'Katorri', code }]);
      // Names only: nothing else about the person comes back.
      expect(Object.keys(await lookup(asAnon, code)).sort()).toEqual(['active', 'name']);

      // The Members tab's read.
      const { rows } = await asUser(OWNER, `select * from public.guild_recruiter_list(${WGA})`);
      expect(rows).toEqual([{ person_id: raider, display_name: 'Katorri', code, active: true, in_guild: true }]);
      expect((await audits(q)).map((r) => r.action)).toEqual(['Recruiter Switched On']);
    });
  });

  it('switching off keeps the row and the code: the lookup says inactive, the list drops them, and on again brings the same link back', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const raider = await personOf(q, RAIDER_T1);
      const code = await setRecruiter(asUser, OWNER, raider, true);
      expect(await setRecruiter(asUser, OWNER, raider, false)).toBe(code);
      expect(await lookup(asAnon, code)).toMatchObject({ active: false });
      expect(await activeList(asAnon)).toEqual([]);
      // The same switch again changes and logs nothing.
      await setRecruiter(asUser, OWNER, raider, false);
      expect(await setRecruiter(asUser, OWNER, raider, true)).toBe(code);
      expect((await audits(q)).map((r) => r.action)).toEqual([
        'Recruiter Switched On',
        'Recruiter Switched Off',
        'Recruiter Switched On'
      ]);
      // Switching off someone who never was a recruiter does nothing.
      expect(await setRecruiter(asUser, OWNER, await personOf(q, OFFICER_T1), false)).toBeNull();
      expect(await audits(q)).toHaveLength(3);
    });
  });

  it('leaving the guild switches a recruiter off and keeps their code; coming back needs an Admin', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const raider = await personOf(q, RAIDER_T1);
      const code = await setRecruiter(asUser, OWNER, raider, true);
      await q('update public.team_members set archived_at = now() where person_id = $1 and archived_at is null', [
        raider
      ]);

      expect(await lookup(asAnon, code)).toMatchObject({ active: false });
      expect(await activeList(asAnon)).toEqual([]);
      const { rows } = await asUser(OWNER, `select code, active, in_guild from public.guild_recruiter_list(${WGA})`);
      expect(rows).toEqual([{ code, active: false, in_guild: false }]);
      expect((await audits(q)).at(-1)).toEqual({
        action: 'Recruiter Switched Off',
        detail: { person_id: raider, code, reason: 'left the guild' }
      });
      await expect(setRecruiter(asUser, OWNER, raider, true)).rejects.toThrow(/not in this guild/);

      // Back on a team, they stay off until an Admin switches them on: same code.
      await q('update public.team_members set archived_at = null where person_id = $1 and team_id = 1', [raider]);
      expect(await lookup(asAnon, code)).toMatchObject({ active: false });
      expect(await setRecruiter(asUser, GUILD_OFFICER, raider, true)).toBe(code);
      expect(await lookup(asAnon, code)).toMatchObject({ active: true });
    });
  });

  it('signed out, a recruiter shows by Name or Discord display name, never the Discord username', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const officer = await personOf(q, OFFICER_T1);
      await q(
        `update auth.identities set identity_data = identity_data || '{"full_name": "kato_handle", "name": "kato_handle"}'
          where user_id = $1`,
        [OFFICER_T1]
      );
      const code = await setRecruiter(asUser, OWNER, officer, true);
      expect(await lookup(asAnon, code)).toEqual({ name: null, active: true });
      expect(await activeList(asAnon)).toEqual([]);
      // The officers' list keeps the full fallback.
      const { rows } = await asUser(OWNER, `select display_name from public.guild_recruiter_list(${WGA})`);
      expect(rows).toEqual([{ display_name: 'kato_handle' }]);

      await q(
        `update auth.identities set identity_data = identity_data || '{"custom_claims": {"global_name": "Kato"}}'
          where user_id = $1`,
        [OFFICER_T1]
      );
      expect(await lookup(asAnon, code)).toEqual({ name: 'Kato', active: true });
      expect(await activeList(asAnon)).toEqual([{ name: 'Kato', code }]);
    });
  });

  it('a code only answers for its own guild, and an unknown code is null', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const code = await setRecruiter(asUser, OWNER, await personOf(q, RAIDER_T1), true);
      await q("insert into public.guilds (name, url_key) values ('Other', 'other-guild')");
      expect(await lookup(asAnon, code, 'other-guild')).toBeNull();
      expect(await lookup(asAnon, 'zzzzzzzz')).toBeNull();
    });
  });

  it('refuses a team officer, a raider, a site admin and signed-out visitors, and someone not in the guild', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const raider = await personOf(q, RAIDER_T1);
      const calls = [
        [`select public.set_guild_recruiter(${WGA}, $1, true)`, [raider]],
        [`select public.guild_recruiter_list(${WGA})`, []]
      ];
      for (const [sql, params] of calls) {
        for (const uid of [OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, SITE_ADMIN]) {
          await expect(asUser(uid, sql, params)).rejects.toThrow(/Not authorized/);
        }
        await expect(asAnon(sql, params)).rejects.toThrow(/permission denied/);
      }
      await expect(asUser(OWNER, 'select * from public.guild_recruiters')).rejects.toThrow(/permission denied/);
      await expect(asAnon('select * from public.guild_recruiters')).rejects.toThrow(/permission denied/);

      const outsider = (await q("insert into public.people (discord_id) values ('discord-1537-outsider') returning id"))
        .rows[0].id;
      await expect(setRecruiter(asUser, OWNER, outsider, true)).rejects.toThrow(/not in this guild/);

      // Another guild's recruiters are that guild's business, not WGA's Owner's or Admins'.
      const other = (await q("insert into public.guilds (name, url_key) values ('Other', 'other-guild') returning id"))
        .rows[0].id;
      await q("insert into public.guild_ranks (guild_id, person_id, rank) values ($1, $2, 'admin')", [other, raider]);
      for (const uid of [OWNER, GUILD_OFFICER]) {
        await expect(asUser(uid, 'select public.set_guild_recruiter($1, $2, true)', [other, raider])).rejects.toThrow(
          /Not authorized/
        );
        await expect(asUser(uid, 'select * from public.guild_recruiter_list($1)', [other])).rejects.toThrow(
          /Not authorized/
        );
      }

      // Taking the grid row off Admins locks them out; the Owner keeps it.
      await q(`delete from public.guild_rank_permissions where guild_id = ${WGA} and permission = 'manage_recruiters'`);
      await expect(setRecruiter(asUser, GUILD_OFFICER, raider, true)).rejects.toThrow(/Not authorized/);
      expect(await setRecruiter(asUser, OWNER, raider, true)).toMatch(/^[a-z0-9]{8}$/);
    });
  });
});
