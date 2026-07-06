# Row-Level Security Policy Reference

This file documents the RLS policies on every public table. The generated schema docs in [`dbdoc/`](../dbdoc/README.md) cover structure (columns, constraints, indexes, FKs) but tbls does not introspect policies, so this file fills that gap by hand.

**Maintenance contract:** policies change only through files in `supabase/migrations/`. Any migration that creates, alters, or drops a policy must update this file in the same PR. The schema-docs CI workflow fails a PR that touches policy SQL without touching this file.

## Concepts

- **`my_team_role(team_id)`**: returns the calling user's role on the given team, resolved from `team_members` via `auth.uid()`. The role column allows exactly `raider`, `officer`, or `admin` (the team admin, top tier within one team). Officer-gated policies accept `officer` or `admin`; admin-gated policies accept `admin` only. No policy references `raider`: being on a team's roster grants no access beyond public read.
- **`is_site_admin()`**: true when `auth.uid()` appears in `site_admins`. This is a separate, global mechanism, not a `team_members` role: site admins pass every policy that ORs it in ("+site" in the matrix) on every team.
- **Public read**: `FOR SELECT USING (true)`. The site's public pages (roster, loot feed, standings) read these tables anonymously.
- **`claude_readers`**: nologin group role for read-only AI/analysis access. Holds one `Claude readers read <table>` SELECT policy on every public table, scoped `TO claude_readers` only. Created by `supabase/roles.sql`; see [claude-readonly-db-access.md](claude-readonly-db-access.md). Add a matching policy when adding a table.
- **Service role**: Supabase's `service_role` bypasses RLS entirely. Tables listed below with no write policy are writable only through the service role (or direct SQL as `postgres`).

## Per-table policy matrix

### How to read this matrix

RLS is deny-by-default: with RLS enabled (it is, on all 20 tables), nobody can touch any row unless a policy explicitly grants it. Policies are additive; if any one policy matches an actor and operation, the action is allowed. Each row below summarizes which grants exist for that table.

- **Public SELECT**: "yes" means a `FOR SELECT USING (true)` policy exists, so anyone (including anonymous visitors) can read every row. This is how the public site serves roster, loot, and standings without login. "no" means there is no public read path.
- **Officer**: what a team officer can do, scoped to their own team's rows via `my_team_role(team_id)`. "all ops" covers SELECT, INSERT, UPDATE, and DELETE. "SELECT, UPDATE" means they can see and modify existing rows but cannot insert or delete. Team admins pass every officer check too, since these policies accept both roles.
- **Admin**: grants beyond the officer policies. "(via officer)" means no separate admin policy exists; admins qualify under the Officer column. "all ops +site" marks admin-only write policies that officers do NOT pass. "+site" anywhere means site admins are OR'd in via `is_site_admin()` regardless of team.
- **Notes**: exceptions and known gaps.
- **A blank cell** means no policy grants that actor anything, so deny-by-default applies. A table with only Public SELECT (like `classes_specs` or `teams`) is a read-only lookup: everyone can read it and only the service role can write it. A table blank in every column except Notes (`site_admins`) is invisible to everyone but the actor named there.

Two things the matrix hides on purpose: every table also carries a `claude_readers` SELECT policy (uniform across all 20 tables, so it is stated here instead of as a column), and per [#284](https://github.com/katogaming88/WGA-Raid-Hub/issues/284) none of the public or officer policies are reachable through the Supabase API yet, because the base grants in front of them are missing.

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
- [#294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294): "team admin" is this document's working name for `team_members.role = 'admin'`; the blessed vocabulary for the permission tiers is still to be decided there.

## Verifying against a live database

Reproduce the raw policy list locally (stack running):

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

The vitest RLS policy-matrix harness on branch `test/rls-policy-harness` exercises these policies with real anon/authenticated/officer/admin JWTs and is the executable form of this document.
