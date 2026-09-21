// Read-path assertions for every public table, driven by the policy matrix
// in docs/RLS.md. If a table is added or a read policy changes, this file
// and that matrix move together.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  countAs,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  SITE_ADMIN,
  TEAM_LEADER_T1,
  GUILD_OFFICER
} from './helpers.js';

// Matrix: tables with a `using (true)` public SELECT policy.
const PUBLIC_READ = [
  'attendance',
  'classes_specs',
  'guilds',
  'item_bosses',
  'items',
  'player_wcl_season_perf',
  'players',
  'priority_order',
  'rclc_loot',
  'scoring',
  'site_settings',
  'team_settings',
  'teams'
];

// Matrix: tables whose SELECT is officer/admin/site-admin scoped. All seeded
// rows in these belong to team 1, so visibility is asserted against team 1.
const GATED = [
  'audit_log',
  'bis_requests',
  'boe_items',
  'boe_listings',
  'guild_grants',
  'mplus_exclusion_requests',
  'player_officer_notes',
  'season_signups',
  'self_received_requests',
  'team_members'
];

// Gated tables an officer can read for their own team. guild_grants is the
// exception, with its own blocks below: the site admin and guild officer grants
// are site-admin only ([#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607)),
// and the BoE manager grants are readable by any officer on any team since the
// grant went guild-wide ([#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766)).
const OFFICER_READABLE = GATED.filter((t) => t !== 'guild_grants');

const SITE_ADMIN_GRANTS = "grant_type = 'site_admin'";
const GUILD_OFFICER_GRANTS = "grant_type = 'guild_officer'";
const BOE_MANAGER_GRANTS = "grant_type = 'boe_manager'";

describe('public-read tables are visible to everyone', () => {
  for (const table of PUBLIC_READ) {
    it(`anon sees seeded rows in ${table}`, async () => {
      expect(await countAs('anon', null, table)).toBeGreaterThan(0);
    });
    it(`raider sees seeded rows in ${table}`, async () => {
      expect(await countAs('authenticated', RAIDER_T1, table)).toBeGreaterThan(0);
    });
  }
});

describe('gated tables hide their rows from anon and raiders', () => {
  for (const table of GATED) {
    it(`anon sees no rows in ${table}`, async () => {
      expect(await countAs('anon', null, table)).toBe(0);
    });
  }
  // team_members has a self-read policy (a member reads their own row, #212);
  // the other gated tables stay fully hidden from raiders.
  for (const table of GATED.filter((t) => t !== 'team_members')) {
    it(`raider sees no rows in ${table}`, async () => {
      expect(await countAs('authenticated', RAIDER_T1, table)).toBe(0);
    });
  }
  it('raider sees only their own team_members row', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'team_members')).toBe(1);
    expect(await countAs('authenticated', RAIDER_T1, 'team_members', 'team_id = 2')).toBe(0);
  });
});

describe('officers read their own team, not other teams', () => {
  const where = { team_members: 'team_id = 1' };
  for (const table of OFFICER_READABLE) {
    it(`team 1 officer sees team 1 rows in ${table}`, async () => {
      expect(await countAs('authenticated', OFFICER_T1, table, where[table] ?? 'team_id = 1')).toBeGreaterThan(0);
    });
    it(`team 2 officer sees no team 1 rows in ${table}`, async () => {
      expect(await countAs('authenticated', OFFICER_T2, table, where[table] ?? 'team_id = 1')).toBe(0);
    });
  }
});

describe('BoE manager grant visibility (#766)', () => {
  // The grant is guild-wide and has no team_id to scope by, so the read is
  // "any officer anywhere", not "an officer on the granted member's team".
  // Deliberately wider than the other grants: an ungranted officer looking at a
  // find they cannot act on needs a way to see who can.
  it('an officer on either team sees the grants', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'guild_grants', BOE_MANAGER_GRANTS)).toBeGreaterThan(0);
    expect(await countAs('authenticated', OFFICER_T2, 'guild_grants', BOE_MANAGER_GRANTS)).toBeGreaterThan(0);
  });
  it('an officer sees no other kind of grant', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'guild_grants', `not (${BOE_MANAGER_GRANTS})`)).toBe(0);
  });
  it('a team leader sees the grants', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'guild_grants', BOE_MANAGER_GRANTS)).toBeGreaterThan(0);
  });
  it('a site admin sees the grants', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'guild_grants', BOE_MANAGER_GRANTS)).toBeGreaterThan(0);
  });
  it('a raider and a guild officer do not', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'guild_grants', BOE_MANAGER_GRANTS)).toBe(0);
    expect(await countAs('authenticated', GUILD_OFFICER, 'guild_grants', BOE_MANAGER_GRANTS)).toBe(0);
  });
  it('anon does not', async () => {
    expect(await countAs('anon', null, 'guild_grants', BOE_MANAGER_GRANTS)).toBe(0);
  });
});

// The old grant table names are read-only views until cutover (#942), for the
// service role and the read-only database role. Neither site reads them.
describe('the old grant table names', () => {
  for (const view of ['site_admins', 'guild_officers', 'boe_managers']) {
    it(`${view} is not readable by a signed-in site admin or by anon`, async () => {
      await expect(countAs('authenticated', SITE_ADMIN, view)).rejects.toThrow(/permission denied/);
      await expect(countAs('anon', null, view)).rejects.toThrow(/permission denied/);
    });
    it(`${view} is readable by the service role`, async () => {
      expect(await countAs('service_role', null, view)).toBeGreaterThan(0);
    });
  }
});

describe('pending_roster view inherits season_signups visibility', () => {
  // security_invoker view over season_signups; the underlying officer-only
  // policies must apply to callers of the view, not the view owner.
  it('anon sees no rows', async () => {
    expect(await countAs('anon', null, 'pending_roster')).toBe(0);
  });
  it('raider sees no rows', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'pending_roster')).toBe(0);
  });
  it('team 1 officer sees team 1 approved signups only', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'pending_roster', 'team_id = 1')).toBeGreaterThan(0);
    expect(await countAs('authenticated', OFFICER_T1, 'pending_roster', 'team_id = 2')).toBe(0);
  });
  it('team 2 officer sees no team 1 rows', async () => {
    expect(await countAs('authenticated', OFFICER_T2, 'pending_roster', 'team_id = 1')).toBe(0);
  });
  it('pending signups do not appear in the view', async () => {
    expect(
      await countAs('authenticated', OFFICER_T1, 'pending_roster', "signup_name_realm = 'Seedsignup-Illidan'")
    ).toBe(0);
  });
});

describe('site admin visibility', () => {
  it('site admin sees team_members', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'team_members')).toBeGreaterThan(0);
  });
  it('site admin sees the site admin grants', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'guild_grants', SITE_ADMIN_GRANTS)).toBeGreaterThan(0);
  });
  it('team 1 team leader cannot see the site admin grants', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'guild_grants', SITE_ADMIN_GRANTS)).toBe(0);
  });

  // #413: a site admin has no team_members row on any team (seed.sql), so
  // seeing team 1's rows here already proves cross-team access -- these four
  // were the only officer-scoped tables missing the is_site_admin()
  // OR-clause every other gated table already has.
  for (const table of ['season_signups', 'bis_requests', 'mplus_exclusion_requests', 'self_received_requests']) {
    it(`site admin sees ${table} rows despite no team_members role anywhere`, async () => {
      expect(await countAs('authenticated', SITE_ADMIN, table, 'team_id = 1')).toBeGreaterThan(0);
    });
  }
  it('site admin sees season_signups rows on team 2 too', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'season_signups', 'team_id = 2')).toBeGreaterThan(0);
  });
});

describe('guild officer visibility (#607)', () => {
  // GUILD_OFFICER holds no team_members role on team 1 beyond a plain
  // raider row -- seeing team 1's audit_log/team_members rows here proves
  // the cross-team grant, same shape as the site-admin block above.
  it('guild officer sees team 1 audit_log rows', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'audit_log', 'team_id = 1')).toBeGreaterThan(0);
  });
  it('guild officer sees team 1 team_members rows beyond their own', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'team_members', 'team_id = 1')).toBeGreaterThan(0);
  });
  it('guild officer cannot see the guild officer grants (site-admin only, like the site admin grants)', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'guild_grants', GUILD_OFFICER_GRANTS)).toBe(0);
  });
  it('site admin sees the guild officer grants', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'guild_grants', GUILD_OFFICER_GRANTS)).toBeGreaterThan(0);
  });
  it('team 1 team leader cannot see the guild officer grants', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'guild_grants', GUILD_OFFICER_GRANTS)).toBe(0);
  });
});

afterAll(() => pool.end());
