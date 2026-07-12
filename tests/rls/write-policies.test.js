// Write-path assertions per policy shape. Payloads reference seeded rows
// (supabase/seed.sql) and satisfy every CHECK constraint and the
// check_team_id_matches_player trigger, so the only variable is the role;
// a rejection can only come from RLS. Every statement runs in a rolled-back
// transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, queryAs, RLS_DENIED, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

async function expectDenied(role, uid, sql, params) {
  await expect(queryAs(role, uid, sql, params)).rejects.toMatchObject({ code: RLS_DENIED });
}

// Tables with a direct my_team_role(team_id) officer-write policy. All
// payloads target team 1 with team-1 players.
const DIRECT_TEAM_INSERTS = {
  players: "insert into public.players (team_id, name_realm) values (1, 'Testinsert-Illidan')",
  attendance:
    "insert into public.attendance (team_id, player_id, raid_date, status) values (1, 1, '2026-02-02', 'Present')",
  priority_order:
    "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, 'test-season', 1, 'Hero', 1, 1)",
  rclc_loot:
    "insert into public.rclc_loot (team_id, player_id, item_id, track, season) values (1, 1, 1, 'Hero', 'test-season')",
  player_wcl_season_perf:
    "insert into public.player_wcl_season_perf (player_id, team_id, season) values (1, 1, 'test-season')"
};

describe('officer-write tables (direct team_id scope)', () => {
  for (const [table, sql] of Object.entries(DIRECT_TEAM_INSERTS)) {
    it(`team 1 officer can insert into ${table}`, async () => {
      const res = await queryAs('authenticated', OFFICER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    // Regression for #293 on player_wcl_season_perf: WITH CHECK used to
    // allow only officer, so admins passed USING but failed every write.
    it(`team 1 team leader can insert into ${table}`, async () => {
      const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    it(`raider cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', RAIDER_T1, sql);
    });
    it(`anon cannot insert into ${table}`, async () => {
      await expectDenied('anon', null, sql);
    });
    it(`team 2 officer cannot insert team 1 rows into ${table}`, async () => {
      await expectDenied('authenticated', OFFICER_T2, sql);
    });
  }
});

describe('officer-write tables (team resolved through players subquery)', () => {
  // player 2 is on team 1; item 2 avoids the seeded unique pairs.
  const SUBQUERY_INSERTS = {
    bis_items: 'insert into public.bis_items (player_id, item_id) values (2, 2)',
    scoring: "insert into public.scoring (player_id, season) values (2, 'test-season')"
  };
  for (const [table, sql] of Object.entries(SUBQUERY_INSERTS)) {
    it(`team 1 officer can insert into ${table} for a team 1 player`, async () => {
      const res = await queryAs('authenticated', OFFICER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    it(`team 2 officer cannot insert into ${table} for a team 1 player`, async () => {
      await expectDenied('authenticated', OFFICER_T2, sql);
    });
    it(`raider cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', RAIDER_T1, sql);
    });
  }
});

describe('team_members is team-leader and site-admin only', () => {
  const sql = "insert into public.team_members (team_id, discord_id, role) values (1, 'discord-new-member', 'raider')";
  it('team 1 team leader can insert', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('site admin can insert', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 officer cannot insert', async () => {
    await expectDenied('authenticated', OFFICER_T1, sql);
  });
});

describe('team_settings is team-leader and site-admin only', () => {
  const sql = `update public.team_settings set config = '{"seeded": false}' where team_id = 1`;
  it('team 1 team leader can update team 1 settings', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('site admin can update team 1 settings', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 officer update touches no rows', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rowCount).toBe(0);
  });
});

describe('site_admins is site-admin only', () => {
  const sql = "insert into public.site_admins (discord_id) values ('discord-new-site-admin')";
  it('site admin can insert', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 team leader cannot insert', async () => {
    await expectDenied('authenticated', TEAM_LEADER_T1, sql);
  });
});

describe('request tables have no INSERT path (service role only)', () => {
  const REQUEST_INSERTS = {
    bis_requests:
      "insert into public.bis_requests (team_id, player_id, bis_link) values (1, 1, 'https://example.com/test')",
    mplus_exclusion_requests:
      "insert into public.mplus_exclusion_requests (team_id, player_id, reason) values (1, 2, 'test')",
    season_signups:
      "insert into public.season_signups (team_id, signup_name_realm, season) values (1, 'Testsignup-Illidan', 'test-season')",
    self_received_requests:
      'insert into public.self_received_requests (team_id, player_id, self_item_id) values (1, 1, 1)'
  };
  for (const [table, sql] of Object.entries(REQUEST_INSERTS)) {
    it(`even a team 1 officer cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', OFFICER_T1, sql);
    });
  }
});

describe('request tables allow officer review updates', () => {
  const sql = "update public.bis_requests set status = 'approved' where id = 1";
  it('team 1 officer can update a team 1 request', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('raider update touches no rows', async () => {
    const res = await queryAs('authenticated', RAIDER_T1, sql);
    expect(res.rowCount).toBe(0);
  });
  it('team 2 officer update touches no rows', async () => {
    const res = await queryAs('authenticated', OFFICER_T2, sql);
    expect(res.rowCount).toBe(0);
  });
  // #413: site admin has no team_members row on team 1 at all, unlike the
  // officer/raider/team-2-officer cases above.
  it('site admin can update a team 1 request despite no team_members role there', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
});

describe('add_signup_to_roster is officer-gated through RLS', () => {
  // SECURITY INVOKER function; seeded signup 2 is team 1, status approved.
  const sql = 'select public.add_signup_to_roster(2) as player_id';
  it('team 1 officer can promote a team 1 signup', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rows[0].player_id).toBeGreaterThan(0);
  });
  it('team 1 team leader can promote a team 1 signup', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rows[0].player_id).toBeGreaterThan(0);
  });
  it('anon has no execute grant', async () => {
    await expectDenied('anon', null, sql);
  });
  it('raider cannot promote (signup invisible under RLS)', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, sql)).rejects.toThrow(/not found/);
  });
  it('team 2 officer cannot promote a team 1 signup', async () => {
    await expect(queryAs('authenticated', OFFICER_T2, sql)).rejects.toThrow(/not found/);
  });
});

describe('audit_log has no client write path', () => {
  const sql = "insert into public.audit_log (team_id, action) values (1, 'test-action')";
  it('team 1 officer cannot insert', async () => {
    await expectDenied('authenticated', OFFICER_T1, sql);
  });
  it('site admin cannot insert', async () => {
    await expectDenied('authenticated', SITE_ADMIN, sql);
  });
});

afterAll(() => pool.end());
