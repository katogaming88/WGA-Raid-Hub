// Behavior tests for #1114: guilds, URL keys, player codes, retired keys and
// resolve_address(). Covers who can read and who can change keys, the key
// formats, the per-guild team key, the fixed player code, and every WGA
// address shape from #1100's map, including one through a retired key.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn):
// fixtures as postgres, impersonated calls as the caller.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, RAIDER_T1, OFFICER_T1, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

// Seeded: guild 'wga' (made by the migration), teams 1 phoenix, 2 hellfire,
// 3 immolation, 4 wrathless; player 1 is on team 1 and is only ever read.
const resolve = (run, guild, team = null, player = null) =>
  run('select * from public.resolve_address($1, $2, $3)', [guild, team, player]).then((r) => r.rows);

const codeOf = async (q, playerId) =>
  (await q('select url_code from public.players where id = $1', [playerId])).rows[0].url_code;

describe('guild and key data', () => {
  it('every team belongs to WGA, and WGA keeps its readable keys', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        'select t.slug, g.url_key from public.teams t join public.guilds g on g.id = t.guild_id order by t.id'
      );
      expect(res.rows.map((r) => r.slug)).toEqual(['phoenix', 'hellfire', 'immolation', 'wrathless']);
      expect(new Set(res.rows.map((r) => r.url_key))).toEqual(new Set(['wga']));
    });
  });

  it('every player has an 8-character code, and a new player gets one', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into public.players (team_id, name_realm) values (1, 'Newcode-Illidan')");
      const res = await q('select url_code from public.players');
      expect(res.rows.length).toBeGreaterThan(1);
      for (const row of res.rows) expect(row.url_code).toMatch(/^[a-z0-9]{8}$/);
    });
  });

  it('a new guild without a key gets a random code', async () => {
    await withTxn(async ({ q }) => {
      const res = await q("insert into public.guilds (name) values ('Other Guild') returning url_key");
      expect(res.rows[0].url_key).toMatch(/^[a-z0-9]{8}$/);
    });
  });

  it('keys must be lowercase letters, digits and single hyphens', async () => {
    await withTxn(async ({ q, asRole }) => {
      const asPostgres = asRole('postgres', null);
      await expect(asPostgres("update public.teams set slug = 'Team Phoenix' where id = 1")).rejects.toThrow(
        /teams_slug_format/
      );
      await expect(asPostgres("update public.guilds set url_key = 'wga--x'")).rejects.toThrow(/guilds_url_key_format/);
      await expect(asPostgres("update public.teams set slug = 'x' where id = 1")).rejects.toThrow(/teams_slug_format/);
      await q("update public.teams set slug = 'team-phoenix' where id = 1");
    });
  });

  it('a team key is unique within its guild, not across guilds', async () => {
    await withTxn(async ({ q, asRole }) => {
      const other = (await q("insert into public.guilds (name, url_key) values ('Other Guild', 'other') returning id"))
        .rows[0].id;
      await q("insert into public.teams (name, slug, guild_id) values ('Other Phoenix', 'phoenix', $1)", [other]);
      const wga = (await q("select id from public.guilds where url_key = 'wga'")).rows[0].id;
      await expect(
        asRole('postgres', null)(
          "insert into public.teams (name, slug, guild_id) values ('Second Phoenix', 'phoenix', $1)",
          [wga]
        )
      ).rejects.toThrow(/teams_guild_id_slug_key/);
    });
  });
});

describe('who can read and change keys', () => {
  it('anon reads guilds, retired keys and player codes, and can resolve an address', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await q("update public.teams set slug = 'team-phoenix' where id = 1");
      expect((await asAnon('select url_key from public.guilds')).rows).toEqual([{ url_key: 'wga' }]);
      expect((await asAnon('select url_key from public.retired_url_keys')).rows).toEqual([{ url_key: 'phoenix' }]);
      expect((await asAnon('select url_code from public.players where id = 1')).rows[0].url_code).toMatch(
        /^[a-z0-9]{8}$/
      );
      expect(await resolve(asAnon, 'wga', 'phoenix')).toHaveLength(1);
    });
  });

  for (const [who, uid] of [
    ['a raider', RAIDER_T1],
    ['an officer', OFFICER_T1],
    ['a site admin', SITE_ADMIN]
  ]) {
    it(`${who} cannot write guilds or retired keys directly`, async () => {
      await withTxn(async ({ q, asUser }) => {
        // Refused outright (no update grant) or filtered to zero rows; either way nothing changes.
        await asUser(uid, "update public.guilds set url_key = 'changed'").catch(() => {});
        await expect(asUser(uid, "insert into public.guilds (name) values ('Sneaky')")).rejects.toThrow();
        const gid = (await q('select id from public.guilds')).rows[0].id;
        await expect(
          asUser(uid, "insert into public.retired_url_keys (guild_id, url_key) values ($1, 'sneaky')", [gid])
        ).rejects.toThrow();
        expect((await q('select url_key from public.guilds')).rows).toEqual([{ url_key: 'wga' }]);
      });
    });
  }

  it('an officer cannot change a team key directly', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, "update public.teams set slug = 'changed' where id = 1").catch(() => {});
      expect((await q('select slug from public.teams where id = 1')).rows[0].slug).toBe('phoenix');
    });
  });

  it('a player code cannot change, even for an officer who can edit the row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await seedPlayer(q, { teamId: 1 });
      await expect(
        asUser(OFFICER_T1, "update public.players set url_code = 'aaaaaaaa' where id = $1", [pid])
      ).rejects.toThrow(/url_code cannot change/);
      await asUser(OFFICER_T1, "update public.players set nickname = 'Still editable' where id = $1", [pid]);
      expect((await q('select nickname from public.players where id = $1', [pid])).rows[0].nickname).toBe(
        'Still editable'
      );
    });
  });

  it('a site admin changes a team key through admin_update_team, and the old key is retired', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, "select public.admin_update_team(1, 'Team Phoenix', 'team-phoenix')");
      const retired = await q('select team_id, url_key from public.retired_url_keys');
      expect(retired.rows).toEqual([{ team_id: 1, url_key: 'phoenix' }]);
    });
  });

  it('an officer cannot use admin_update_team', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, "select public.admin_update_team(1, 'Team Phoenix', 'mine')")).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('admin_create_team puts the new team in the guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = (await asUser(SITE_ADMIN, "select public.admin_create_team('New Team', 'new-team') as id")).rows[0].id;
      const res = await q(
        'select g.url_key from public.teams t join public.guilds g on g.id = t.guild_id where t.id = $1',
        [id]
      );
      expect(res.rows[0].url_key).toBe('wga');
    });
  });

  it('admin_create_team refuses to guess once there is a second guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.guilds (name, url_key) values ('Other Guild', 'other')");
      await expect(asUser(SITE_ADMIN, "select public.admin_create_team('New Team', 'new-team')")).rejects.toThrow(
        /more than one/
      );
    });
  });
});

describe('resolve_address', () => {
  it('resolves a guild on its own', async () => {
    await withTxn(async ({ q }) => {
      const rows = await resolve(q, 'wga');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ guild_key: 'wga', team_id: null, player_id: null, is_canonical: true });
    });
  });

  it('resolves every WGA team', async () => {
    await withTxn(async ({ q }) => {
      for (const [slug, id] of [
        ['phoenix', 1],
        ['hellfire', 2],
        ['immolation', 3],
        ['wrathless', 4]
      ]) {
        const rows = await resolve(q, 'wga', slug);
        expect(rows[0]).toMatchObject({ guild_key: 'wga', team_id: id, team_key: slug, is_canonical: true });
      }
    });
  });

  it('resolves a player under their team', async () => {
    await withTxn(async ({ q }) => {
      const code = await codeOf(q, 1);
      const rows = await resolve(q, 'wga', 'phoenix', code);
      expect(rows[0]).toMatchObject({ team_id: 1, player_id: 1, player_code: code, is_canonical: true });
    });
  });

  it('accepts any letter case but flags it for a redirect', async () => {
    await withTxn(async ({ q }) => {
      const code = await codeOf(q, 1);
      const rows = await resolve(q, 'WGA', 'Phoenix', code.toUpperCase());
      expect(rows[0]).toMatchObject({ guild_key: 'wga', team_key: 'phoenix', player_id: 1, is_canonical: false });
    });
  });

  it('resolves a retired team key to the current one', async () => {
    await withTxn(async ({ q }) => {
      await q("update public.teams set slug = 'team-phoenix' where id = 1");
      const code = await codeOf(q, 1);
      const rows = await resolve(q, 'wga', 'phoenix', code);
      expect(rows[0]).toMatchObject({ team_id: 1, team_key: 'team-phoenix', player_id: 1, is_canonical: false });
      expect((await resolve(q, 'wga', 'team-phoenix'))[0].is_canonical).toBe(true);
    });
  });

  it('resolves a retired guild key to the current one', async () => {
    await withTxn(async ({ q }) => {
      await q("update public.guilds set url_key = 'we-go-again'");
      const rows = await resolve(q, 'wga', 'hellfire');
      expect(rows[0]).toMatchObject({ guild_key: 'we-go-again', team_id: 2, is_canonical: false });
    });
  });

  it('a key changed back is no longer listed as retired', async () => {
    await withTxn(async ({ q }) => {
      await q("update public.teams set slug = 'team-phoenix' where id = 1");
      await q("update public.teams set slug = 'phoenix' where id = 1");
      const res = await q('select url_key from public.retired_url_keys');
      expect(res.rows).toEqual([{ url_key: 'team-phoenix' }]);
      expect((await resolve(q, 'wga', 'phoenix'))[0].is_canonical).toBe(true);
    });
  });

  it("a current key wins over another team's retired one", async () => {
    await withTxn(async ({ q }) => {
      await q("update public.teams set slug = 'old-hellfire' where id = 2");
      await q("update public.teams set slug = 'hellfire' where id = 3");
      // team 2 used to be 'hellfire'; team 3 is 'hellfire' now.
      const rows = await resolve(q, 'wga', 'hellfire');
      expect(rows[0]).toMatchObject({ team_id: 3, is_canonical: true });
    });
  });

  it("a team that moved guilds is found through its old guild's address", async () => {
    await withTxn(async ({ q }) => {
      const other = (await q("insert into public.guilds (name, url_key) values ('Other Guild', 'other') returning id"))
        .rows[0].id;
      await q('update public.teams set guild_id = $1 where id = 4', [other]);
      const rows = await resolve(q, 'wga', 'wrathless');
      expect(rows[0]).toMatchObject({ guild_key: 'other', team_id: 4, team_key: 'wrathless', is_canonical: false });
    });
  });

  it('returns nothing for an address that does not exist', async () => {
    await withTxn(async ({ q }) => {
      const phoenixPlayer = await codeOf(q, 1);
      expect(await resolve(q, 'nope')).toHaveLength(0);
      expect(await resolve(q, 'wga', 'nope')).toHaveLength(0);
      expect(await resolve(q, 'wga', 'phoenix', 'zzzzzzzz')).toHaveLength(0);
      // A real code under the wrong team is not found, not quietly moved.
      expect(await resolve(q, 'wga', 'hellfire', phoenixPlayer)).toHaveLength(0);
      // A player always sits under a team.
      expect(await resolve(q, 'wga', null, phoenixPlayer)).toHaveLength(0);
    });
  });
});
