// Guild and team names are labels (#1226): guilds may share a name, and a team
// name only has to be unique within its own guild, ignoring case. Identity is
// the url_key / slug and the id.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

describe('guild and team names', () => {
  it('lets two guilds share a name', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into public.guilds (name, region, realm) values ('We Go Again', 'eu', 'Draenor')");
      const { rows } = await q("select count(*)::int as n from public.guilds where name = 'We Go Again'");
      expect(rows[0].n).toBe(2);
    });
  });

  it('lets two guilds each have a team with the same name', async () => {
    await withTxn(async ({ q }) => {
      const g = (await q("insert into public.guilds (name) values ('Other Guild') returning id")).rows[0].id;
      await q('insert into public.teams (name, guild_id) values ($1, $2)', ['Team Phoenix', g]);
      const { rows } = await q("select count(*)::int as n from public.teams where name = 'Team Phoenix'");
      expect(rows[0].n).toBe(2);
    });
  });

  it('refuses two teams with the same name in one guild, whatever the case', async () => {
    await withTxn(async ({ q }) => {
      await expect(q("insert into public.teams (name, guild_id) values ('team phoenix', 1)")).rejects.toThrow(
        /teams_guild_id_lower_name_key/
      );
    });
  });

  it('holds for admin_create_team() too', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, "select public.admin_create_team('TEAM PHOENIX', 'dupe')")).rejects.toThrow(
        /teams_guild_id_lower_name_key/
      );
    });
  });

  it('allows numbered names in one guild', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into public.teams (name, guild_id) values ('WGA Team 1', 1), ('WGA Team 2', 1)");
      const { rows } = await q("select count(*)::int as n from public.teams where name like 'WGA Team %'");
      expect(rows[0].n).toBe(2);
    });
  });
});
