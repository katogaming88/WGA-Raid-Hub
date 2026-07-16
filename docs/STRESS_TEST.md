# Stress Testing Guide

Steps to run a user stress test against a copy of the app without touching production data.

## Setup

### 1. Create a test Supabase project

- Create a new Supabase project, separate from the shared production project
  (`kxgjqnpwfklbgrxdgmmv`) that Phoenix, Hellfire, and Immolation all run on.
- Run the full schema migration SQL from `supabase/migrations/` against it (or restore
  a schema-only dump from production) -- reference tables, `teams`, `team_members`,
  `players`, `scoring`, `bis_items`, `rclc_loot`, `attendance`, `priority_order`,
  `items`/`item_bosses`, the request queue tables, `audit_log`, `team_settings`, RLS
  enabled on everything, and all policies.
- Seed the `teams` row(s) you need (e.g. `Phoenix` / `phoenix`).

### 2. Seed test data

- Prod is reachable read-only via the `claude_ro_kat` role (see
  `docs/claude-readonly-db-access.md`). Dump the tables you need for the test --
  `players`, `scoring`, `bis_items`, `rclc_loot`, `attendance`, `priority_order`,
  `team_settings` -- and load them into the test project's SQL Editor, remapping
  `team_id` to whatever id the test project assigned your seeded team.
- Seed at least one officer/admin row in `team_members` (or `site_admins`) for
  whichever Discord account will be testing officer flows.

### 3. Configure Discord OAuth for the test project

- In the test project's **Authentication > Providers > Discord**, reuse the same
  Client ID/Secret as production's Discord application (Developer Portal), unless
  you'd rather register a second Discord application just for testing.
- Add the test project's callback URL
  (`https://<test-project-ref>.supabase.co/auth/v1/callback`) as an additional
  Redirect URI on whichever Discord application you used above -- do not remove the
  production redirect.

### 4. Point the frontend at the test project

`SUPABASE_URL` / `SUPABASE_ANON_KEY` (`js/common.js`) are a single client shared by
every team -- there is no per-team Supabase project override the way `TEAMS` has a
per-team `supabaseTeamId`. To run against the test project instead of production,
temporarily edit those two constants locally (never commit this):

```javascript
var SUPABASE_URL = 'https://<TEST_PROJECT_REF>.supabase.co';
var SUPABASE_ANON_KEY = '<TEST_PROJECT_ANON_KEY>';
```

Then make sure the team you're testing with resolves to a `supabaseTeamId` that
actually exists as a `teams` row in the test project -- either reuse an existing
`TEAMS` slug (e.g. `phoenix`) if you seeded its `team_id` to match, or add a
temporary slug pointing at whatever id you seeded:

```javascript
var TEAMS = {
  phoenix: { name: 'Phoenix', supabaseTeamId: 1 },     // production -- do not change
  hellfire: { name: 'Hellfire Rollers', supabaseTeamId: 2 }, // production -- do not change
  immolation: { name: 'Immolation', supabaseTeamId: 3 },     // production -- do not change
  test: { name: 'Test Team', supabaseTeamId: <test_project_team_id> }
};
```

Testers access the test environment the normal way, `?team=test` -- the isolation
from production comes entirely from the `SUPABASE_URL`/`SUPABASE_ANON_KEY` swap
above, not from anything specific to the `?team=` param itself.

- Public page: `https://katogaming88.github.io/WGA-Raid-Hub/index.html?team=test`
- Officer page: `https://katogaming88.github.io/WGA-Raid-Hub/officer.html?team=test`

Production teams are unaffected as long as `SUPABASE_URL`/`SUPABASE_ANON_KEY` are
reverted before committing anything.

### 5. Add dummy entries for testers with no seeded character

The test project is seeded from one team's roster (e.g. Phoenix). Testers who don't
have a character on that roster won't have anything to claim, and once a character
is claimed no one else can claim it -- give each of them their own slot.

Before the test, collect the list of such testers and insert one dummy row per
person into the test project's `players` table via the SQL Editor:

```sql
insert into players (team_id, name_realm, role, class, spec) values
  (<test_team_id>, 'Tester-Stormrage', 'Melee', 'Warrior', 'Fury');
```

Let each tester know which dummy name is theirs before the session starts.

### 6. Discord login during the test

Discord login always does a full-page redirect (`signInWithOAuth`) -- there's no
localhost-specific bypass. For the login flow to actually complete:

- The test project's Discord provider must be configured (step 3 above).
- The origin you're testing from needs to be one the OAuth round-trip actually
  returns to correctly. The simplest, most reliable path is testing from the GitHub
  Pages URL with `?team=test` rather than from `localhost`, since that's the origin
  already exercised in production.
- Non-Discord flows (roster, loot, attendance, officer writes made while already
  logged in) work fine locally regardless.

## Cleanup

- Revert the local `SUPABASE_URL`/`SUPABASE_ANON_KEY` edit in `js/common.js` -- never
  commit it
- Remove the temporary `test` entry from `TEAMS` if you added one
- Delete the test Supabase project (Project Settings -> General -> Delete project)
- Remove the test project's redirect URL from the Discord Developer Portal
