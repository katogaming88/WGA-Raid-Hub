// create_guild(), guild_creation_open() and admin_set_guild_creation_open()
// (#1226): a signed-in person creates a guild and its first team, behind a
// switch a site admin flips. Closed by default: then only a site admin can.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, SITE_ADMIN, OFFICER_T1, RLS_DENIED, insertDiscordUser } from './helpers.js';

afterAll(() => pool.end());

const create = (asUser, uid, name = 'Fresh Guild', region = 'us', realm = 'Stormrage', team = 'Fresh Team') =>
  asUser(uid, 'select guild_key, team_key from public.create_guild($1, $2, $3, $4)', [name, region, realm, team]);

const open = (asUser, value = true) => asUser(SITE_ADMIN, 'select public.admin_set_guild_creation_open($1)', [value]);

// A signed-in account with a Discord login and no team at all.
async function newcomer(q) {
  const uid = randomUUID();
  await insertDiscordUser(q, uid, `newcomer-${uid}`);
  return uid;
}

describe('the guild-creation switch', () => {
  it('starts closed and anyone, signed in or not, can read it', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      expect((await asAnon('select public.guild_creation_open() as open')).rows[0].open).toBe(false);
      await open(asUser);
      expect((await asAnon('select public.guild_creation_open() as open')).rows[0].open).toBe(true);
      await open(asUser, false);
      expect((await asUser(OFFICER_T1, 'select public.guild_creation_open() as open')).rows[0].open).toBe(false);
    });
  });

  it('is flipped only by a site admin, and audited', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await expect(asUser(OFFICER_T1, 'select public.admin_set_guild_creation_open(true)')).rejects.toThrow(
        /Not authorized/
      );
      await expect(asAnon('select public.admin_set_guild_creation_open(true)')).rejects.toMatchObject({
        code: RLS_DENIED
      });
      await open(asUser);
      await open(asUser, false);
      const { rows } = await q("select action from public.audit_log where action like 'guild_creation_%' order by id");
      expect(rows.map((r) => r.action)).toEqual(['guild_creation_opened', 'guild_creation_closed']);
    });
  });
});

describe('create_guild()', () => {
  it('while closed, refuses everyone but a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(create(asUser, await newcomer(q))).rejects.toThrow(/not open yet/);
      await expect(create(asUser, OFFICER_T1)).rejects.toThrow(/not open yet/);
      expect((await create(asUser, SITE_ADMIN)).rows).toHaveLength(1);
    });
  });

  it('once open, makes the guild, its team, settings and the creator as team leader', async () => {
    await withTxn(async ({ q, asUser }) => {
      await open(asUser);
      const uid = await newcomer(q);
      const { rows } = await create(asUser, uid);
      const { guild_key, team_key } = rows[0];
      expect(guild_key).toMatch(/^[a-z0-9]+$/);
      expect(team_key).toMatch(/^[a-z0-9]+$/);

      const made = await q(
        `select g.name, g.region, g.realm, t.name as team, tm.role, ts.config
           from public.guilds g
           join public.teams t on t.guild_id = g.id
           join public.team_settings ts on ts.team_id = t.id
           join public.team_members tm on tm.team_id = t.id
           join public.people pe on pe.id = tm.person_id
          where g.url_key = $1 and t.slug = $2 and pe.auth_user_id = $3`,
        [guild_key, team_key, uid]
      );
      expect(made.rows).toEqual([
        { name: 'Fresh Guild', region: 'us', realm: 'Stormrage', team: 'Fresh Team', role: 'team_leader', config: {} }
      ]);
      const audit = await q("select detail from public.audit_log where action = 'Guild Created'");
      expect(audit.rows).toEqual([{ detail: { guild: 'Fresh Guild', team: 'Fresh Team' } }]);
    });
  });

  it('refuses a missing session, no Discord, a bad region, blanks and names already taken; anon cannot call it', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await open(asUser);
      const uid = await newcomer(q);
      await expect(create(asUser, null)).rejects.toThrow(/Not signed in/);
      const bare = randomUUID();
      await q('insert into auth.users (id) values ($1)', [bare]);
      await expect(create(asUser, bare)).rejects.toThrow(/Connect Discord/);
      await expect(create(asUser, uid, '  ')).rejects.toThrow(/name/);
      await expect(create(asUser, uid, 'X', 'na')).rejects.toThrow(/region/);
      await expect(create(asUser, uid, 'X', 'us', ' ')).rejects.toThrow(/realm/);
      await expect(create(asUser, uid, 'X', 'us', 'R', ' ')).rejects.toThrow(/first team/);
      await expect(create(asUser, uid, 'we go again')).rejects.toThrow(/already exists/);
      await expect(create(asUser, uid, 'X', 'us', 'R', 'team phoenix')).rejects.toThrow(/already exists/);
      await expect(asAnon("select public.create_guild('X', 'us', 'R', 'T')")).rejects.toMatchObject({
        code: RLS_DENIED
      });
      expect((await q("select count(*) from public.guilds where name = 'X'")).rows[0].count).toBe('0');
    });
  });
});
