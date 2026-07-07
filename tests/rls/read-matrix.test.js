// Read-path assertions for every public table, driven by the policy matrix
// in docs/RLS.md. If a table is added or a read policy changes, this file
// and that matrix move together.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, countAs, OFFICER_T1, OFFICER_T2, RAIDER_T1, SITE_ADMIN, TEAM_LEADER_T1 } from './helpers.js';

// Matrix: tables with a `using (true)` public SELECT policy.
const PUBLIC_READ = [
  'attendance',
  'bis_items',
  'classes_specs',
  'item_bosses',
  'items',
  'player_wcl_season_perf',
  'players',
  'priority_order',
  'rclc_loot',
  'scoring',
  'season_snapshots',
  'team_settings',
  'teams'
];

// Matrix: tables whose SELECT is officer/admin/site-admin scoped. All seeded
// rows in these belong to team 1, so visibility is asserted against team 1.
const GATED = [
  'audit_log',
  'bis_requests',
  'mplus_exclusion_requests',
  'season_signups',
  'self_received_requests',
  'site_admins',
  'team_members'
];

// Gated tables an officer can read for their own team (site_admins is the
// exception: site admins only).
const OFFICER_READABLE = GATED.filter((t) => t !== 'site_admins');

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
    it(`raider sees no rows in ${table}`, async () => {
      expect(await countAs('authenticated', RAIDER_T1, table)).toBe(0);
    });
  }
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
  it('site admin sees site_admins', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'site_admins')).toBeGreaterThan(0);
  });
  it('team 1 team leader cannot see site_admins', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'site_admins')).toBe(0);
  });
});

afterAll(() => pool.end());
