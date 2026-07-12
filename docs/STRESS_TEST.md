# Stress Testing Guide

Steps to run a user stress test against a copy of the app without touching production data.

> **Status note:** this describes the Supabase-based stress test workflow, which
> replaces the old "copy the Google Sheet" process. It assumes the frontend reads
> its data from Supabase (see `docs/supabase-migration-plan.md`). Until that wiring
> lands in `js/common.js`, there is no test path that actually exercises it -- this
> doc documents the target workflow to adopt once that cutover happens.

## Setup

### 1. Create a test Supabase project

- Create a new Supabase project, separate from the shared production project
  (`kxgjqnpwfklbgrxdgmmv`) that Phoenix and Hellfire both run on.
- Run the full schema migration SQL from `docs/supabase-setup-guide.md` (issue #202)
  against it: reference tables, `teams`, `team_members`, `players`, `scoring`,
  `bis_items`, `loot`, `attendance`, `priority_order`, the request queue tables,
  `audit_log`, `settings`, RLS enabled on everything, and all
  policies including `my_team_role()` / `is_site_admin()` and the auth trigger.
- Seed the `teams` row(s) you need (e.g. `Phoenix` / `phoenix`).

### 2. Seed test data

- Prod is reachable read-only via the `claude_ro_kat` role (see
  `docs/claude-readonly-db-access.md`). Dump the tables you need for the test --
  `players`, `scoring`, `bis_items`, `loot`, `attendance`, `priority_order`,
  `settings` -- and load them into the test project's SQL Editor, remapping
  `team_id` to whatever id the test project assigned your seeded team.
- Seed at least one officer/admin row in `team_members` (or `site_admins`) for
  whichever Discord account will be testing officer flows.

### 3. Configure Discord OAuth for the test project

- Same as issue #204 in `docs/supabase-setup-guide.md`, but use the **test
  project's** callback URL (`https://<test-project-ref>.supabase.co/auth/v1/callback`).
- Add it as an additional redirect in the Discord Developer Portal's existing Raid
  Hub application -- do not remove the production redirect.

### 4. Collect test project credentials

In the test project: **Project Settings -> API**, copy the **Project URL** and the
**anon public** key. The anon key is safe to put in test config -- RLS on the test
project's policies is what actually controls access, same as prod.

### 5. Add a test team entry in the frontend

In `js/common.js`, add a test entry to the `TEAMS` object pointing at the test
project instead of a `gasUrl`:

```javascript
var TEAMS = {
  phoenix: { ... },   // production -- do not change
  hellfire: { ... },  // production -- do not change
  test: {
    supabaseUrl: 'https://<TEST_PROJECT_REF>.supabase.co',
    supabaseAnonKey: '<TEST_PROJECT_ANON_KEY>',
    name: 'Test Team',
    officerPass: 'phoenix2'  // same as whichever team you copied
  }
};
```

Testers access the test environment by appending `?team=test` to the URL:
- Public page: `https://katogaming88.github.io/WGA-Raid-Hub/index.html?team=test`
- Officer page: `https://katogaming88.github.io/WGA-Raid-Hub/officer.html?team=test`

Production teams are unaffected.

### 6. Add dummy entries for Hellfire testers

The test project is seeded from the Phoenix roster. Hellfire testers won't have a
character on it and need their own slot to claim -- once a character is claimed, no
one else can claim it.

Before the test, collect the list of Hellfire testers and insert one dummy row per
person into the test project's `players` table via the SQL Editor:

```sql
insert into players (team_id, name_realm, role, class, spec) values
  (<test_team_id>, 'HFTester-Stormrage', 'Melee', 'Warrior', 'Fury');
```

Let each Hellfire tester know which dummy name is theirs before the session starts.
Phoenix testers claim their real character as normal.

### 7. Discord OAuth on localhost

Discord OAuth is automatically disabled on `localhost` / `127.0.0.1` -- the login
popup is skipped and no session is attempted. This means:

- Localhost is fine for testing all non-Discord flows (roster, loot, attendance,
  officer writes)
- To test the Discord login flow end-to-end, use the GitHub Pages URL with
  `?team=test`

## Cleanup

- Remove the `test` entry from `TEAMS` in `js/common.js` when done
- Delete the test Supabase project (Project Settings -> General -> Delete project)
- Remove the test project's redirect URL from the Discord Developer Portal
