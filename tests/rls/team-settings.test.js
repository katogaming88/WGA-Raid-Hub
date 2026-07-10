// set_team_setting/archive_current_season/unarchive_season (#221, Phase 6) --
// season config moved off Script Properties onto team_settings.config. All
// three are SECURITY INVOKER, so the "Team leaders write settings" RLS
// policy is the only gate: a team-1 officer (not team_leader) can call the
// function, but the underlying UPDATE touches 0 rows, same shape as the
// existing direct-update assertions in write-policies.test.js.
//
// Several scenarios need setup as one role (e.g. team leader seeding a
// season) followed by an assertion as another role (e.g. an officer trying
// to archive it) within the SAME transaction, since writes never commit
// across separate pool connections here -- withActors() runs a whole
// scenario on one connection/transaction, switching `request.jwt.claims`
// and `role` between statements, then rolls back at the end.
import { describe, it, expect } from 'vitest';
import { pool, queryAs, TEAM_LEADER_T1, OFFICER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

async function withActors(fn) {
  const client = await pool.connect();
  const as = async (role, uid) => {
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
  };
  try {
    await client.query('begin');
    return await fn(client, as);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('set_team_setting', () => {
  const sql = `select public.set_team_setting(1, '{"seasonName":"Test Season"}'::jsonb) as config`;

  it('team 1 team leader merges the update into config', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rows[0].config.seasonName).toBe('Test Season');
  });

  it('site admin merges the update into config', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rows[0].config.seasonName).toBe('Test Season');
  });

  it('team 1 officer gets a Not authorized error (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', OFFICER_T1);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('raider gets a Not authorized error', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', RAIDER_T1);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('team 2 officer cannot affect team 1 settings', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', OFFICER_T2);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('anon cannot execute the function at all', async () => {
    await expect(queryAs('anon', null, sql)).rejects.toThrow(/permission denied/i);
  });
});

describe('archive_current_season', () => {
  const archiveSql = `select public.archive_current_season(1, '[{"nameRealm":"Test-Realm","role":"Melee"}]'::jsonb) as config`;

  it('moves the active season into seasonHistory and clears the active fields', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(
        `select public.set_team_setting(1, '{"seasonName":"Archive Me","seasonStart":"2026-01-01","raidProgression":[{"name":"Test Raid"}]}'::jsonb)`
      );
      const res = await client.query(archiveSql);
      const config = res.rows[0].config;
      expect(config.seasonName).toBe('');
      expect(config.raidProgression).toEqual([]);
      expect(config.seasonHistory).toHaveLength(1);
      expect(config.seasonHistory[0]).toMatchObject({
        name: 'Archive Me',
        start: '2026-01-01',
        raids: [{ name: 'Test Raid' }],
        roster: [{ nameRealm: 'Test-Realm', role: 'Melee' }]
      });
    });
  });

  it('raises when there is no active season name to archive', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":""}'::jsonb)`);
      await expect(client.query(archiveSql)).rejects.toThrow(/no active season/i);
    });
  });

  it('team 1 officer cannot archive (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":"Archive Me"}'::jsonb)`);
      await as('authenticated', OFFICER_T1);
      await expect(client.query(archiveSql)).rejects.toThrow(/not authorized/i);
    });
  });
});

describe('unarchive_season', () => {
  async function seedHistory(client) {
    await client.query(
      `select public.set_team_setting(1, '{"seasonName":"","seasonHistory":[{"name":"Old Season","start":"2025-01-01","end":"2025-06-01","raids":[],"roster":[]}]}'::jsonb)`
    );
  }

  it('restores the season at the given index and removes it from history', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      const res = await client.query('select public.unarchive_season(1, 0) as result');
      const result = res.rows[0].result;
      expect(result.season.name).toBe('Old Season');
      expect(result.config.seasonName).toBe('Old Season');
      expect(result.config.seasonHistory).toEqual([]);
    });
  });

  it('raises on an out-of-range index', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      await expect(client.query('select public.unarchive_season(1, 5) as result')).rejects.toThrow(
        /invalid season index/i
      );
    });
  });

  it('team 1 officer cannot unarchive (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      await as('authenticated', OFFICER_T1);
      await expect(client.query('select public.unarchive_season(1, 0) as result')).rejects.toThrow(/not authorized/i);
    });
  });
});
