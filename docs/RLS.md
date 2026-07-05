# Row-Level Security Policy Reference

This file documents the RLS policies on every public table. The generated schema docs in [`dbdoc/`](../dbdoc/README.md) cover structure (columns, constraints, indexes, FKs) but tbls does not introspect policies, so this file fills that gap by hand.

**Maintenance contract:** policies change only through files in `supabase/migrations/`. Any migration that creates, alters, or drops a policy must update this file in the same PR. The schema-docs CI workflow fails a PR that touches policy SQL without touching this file.

## Concepts

- **`my_team_role(team_id)`**: returns the calling user's role (`officer`, `admin`, or member) on the given team, resolved from `team_members` via `auth.uid()`. Officer-gated policies accept `officer` or `admin`; admin-gated policies accept `admin` only.
- **`is_site_admin()`**: true when `auth.uid()` appears in `site_admins`. Site admins bypass team scoping on the tables that OR it in.
- **Public read**: `FOR SELECT USING (true)`. The site's public pages (roster, loot feed, standings) read these tables anonymously.
- **`claude_readers`**: nologin group role for read-only AI/analysis access. Holds one `Claude readers read <table>` SELECT policy on every public table, scoped `TO claude_readers` only. Created by `supabase/roles.sql`; see [claude-readonly-db-access.md](claude-readonly-db-access.md). Add a matching policy when adding a table.
- **Service role**: Supabase's `service_role` bypasses RLS entirely. Tables listed below with no write policy are writable only through the service role (or direct SQL as `postgres`).

## Per-table policy matrix

Every table also has a `claude_readers` SELECT policy; it is omitted from the matrix. "Officer" means team officer or team admin via `my_team_role`. "+site" means site admins are OR'd in via `is_site_admin()`.

| Table | Public SELECT | Officer | Admin | Notes |
| --- | --- | --- | --- | --- |
| attendance | yes | all ops | (via officer) | |
| audit_log | no | SELECT +site | | No write policy; writes are service-role only |
| bis_items | yes | all ops | (via officer) | Team resolved through `players.team_id` subquery |
| bis_requests | no | SELECT, UPDATE | | No INSERT policy; submissions are service-role only |
| classes_specs | yes | | | Read-only lookup; no write policy |
| item_bosses | yes | | | Read-only lookup; no write policy |
| items | yes | | | Read-only lookup; no write policy |
| mplus_exclusion_requests | no | SELECT, UPDATE | | No INSERT policy; submissions are service-role only |
| player_wcl_season_perf | yes | all ops | (broken, #293) | Write policy's WITH CHECK allows officer only, so admin writes fail; public-read policy name has a typo. Both tracked in [#293](https://github.com/katogaming88/WGA-Raid-Hub/issues/293) |
| players | yes | all ops | (via officer) | |
| priority_order | yes | all ops | (via officer) | |
| rclc_loot | yes | all ops | (via officer) | |
| scoring | yes | all ops | (via officer) | Team resolved through `players.team_id` subquery |
| season_signups | no | SELECT, UPDATE | | No INSERT policy; submissions are service-role only |
| season_snapshots | yes | | all ops +site | |
| self_received_requests | no | SELECT, UPDATE | | No INSERT policy; submissions are service-role only |
| site_admins | no | | | Site admins only: SELECT and all ops via `is_site_admin()` |
| team_members | no | SELECT +site | all ops +site | |
| team_settings | yes | | all ops +site | |
| teams | yes | | | Read-only lookup; no write policy |

## Known issues

- [#284](https://github.com/katogaming88/WGA-Raid-Hub/issues/284): `anon` and `authenticated` are missing base SELECT/INSERT/UPDATE/DELETE grants on every table, so none of the public or officer policies above are reachable through the Supabase API yet. The policies are correct; the grants gate in front of them is closed.
- [#293](https://github.com/katogaming88/WGA-Raid-Hub/issues/293): `player_wcl_season_perf` write policy blocks admins (WITH CHECK asymmetry) and its public-read policy name has a typo (`Public reas`).
- The four request tables (`bis_requests`, `mplus_exclusion_requests`, `self_received_requests`, `season_signups`) have no INSERT policies. Raider-facing submission flows will need them (or an Edge Function using the service role) when those features move off Apps Script.

## Verifying against a live database

Reproduce the raw policy list locally (stack running):

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

The vitest RLS policy-matrix harness on branch `test/rls-policy-harness` exercises these policies with real anon/authenticated/officer/admin JWTs and is the executable form of this document.
