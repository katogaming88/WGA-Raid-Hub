# Row-Level Security Policy Reference

This file documents the RLS policies on every public table. The generated schema docs in [`dbdoc/`](../dbdoc/README.md) cover structure (columns, constraints, indexes, FKs) but tbls does not introspect policies, so this file fills that gap by hand.

**Maintenance contract:** policies change only through files in `supabase/migrations/`. Any migration that creates, alters, or drops a policy must update this file in the same PR. The schema-docs CI workflow fails a PR that touches policy SQL without touching this file.

## Concepts

- **`my_team_role(team_id)`**: returns the calling user's role on the given team, resolved from `team_members` via `auth.uid()`. The role column allows exactly `raider`, `officer`, or `team_leader` (top tier within one team; named by [#294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294) to stay distinct from site admins). Officer-gated policies accept `officer` or `team_leader`; team-leader-gated policies accept `team_leader` only. No policy grants a `raider` role any team data, though a member of any role can read their own `team_members` row through the self-read policy ([#212](https://github.com/katogaming88/WGA-Raid-Hub/issues/212), see the matrix note); being on a team's roster otherwise grants no access beyond public read.
- **`is_site_admin()`**: true when `auth.uid()` appears in `site_admins`. This is a separate, global mechanism, not a `team_members` role: site admins pass every policy that ORs it in ("+site" in the matrix) on every team.
- **Public read**: `FOR SELECT USING (true)`. The site's public pages (roster, loot feed, standings) read these tables anonymously.
- **`claude_readers`**: nologin group role for read-only AI/analysis access. Holds one `Claude readers read <table>` SELECT policy on every public table, scoped `TO claude_readers` only. Created by `supabase/roles.sql`; see [claude-readonly-db-access.md](claude-readonly-db-access.md). Add a matching policy when adding a table.
- **Service role**: Supabase's `service_role` bypasses RLS entirely. Tables listed below with no write policy are writable only through the service role (or direct SQL as `postgres`).

## Per-table policy matrix

### How to read this matrix

RLS is deny-by-default: with RLS enabled (it is, on all 21 tables), nobody can touch any row unless a policy explicitly grants it. Policies are additive; if any one policy matches an actor and operation, the action is allowed. Each row below summarizes which grants exist for that table.

- **Public SELECT**: "yes" means a `FOR SELECT USING (true)` policy exists, so anyone (including anonymous visitors) can read every row. This is how the public site serves roster, loot, and standings without login. "no" means there is no public read path.
- **Officer**: what a team officer can do, scoped to their own team's rows via `my_team_role(team_id)`. "all ops" covers SELECT, INSERT, UPDATE, and DELETE. "SELECT, UPDATE" means they can see and modify existing rows but cannot insert or delete. Team leaders pass every officer check too, since these policies accept both roles.
- **Team leader**: grants beyond the officer policies. "(via officer)" means no separate team-leader policy exists; team leaders qualify under the Officer column. "all ops +site" marks team-leader-only write policies that officers do NOT pass. "+site" anywhere means site admins are OR'd in via `is_site_admin()` regardless of team.
- **Notes**: exceptions and known gaps.
- **A blank cell** means no policy grants that actor anything, so deny-by-default applies. A table with only Public SELECT (like `classes_specs` or `teams`) is a read-only lookup: everyone can read it and only the service role can write it. A table blank in every column except Notes (`site_admins`) is invisible to everyone but the actor named there.

One thing the matrix hides on purpose: every table also carries a `claude_readers` SELECT policy (uniform across all 20 tables, so it is stated here instead of as a column).

| Table | Public SELECT | Officer | Team leader | Notes |
| --- | --- | --- | --- | --- |
| attendance | yes | all ops | (via officer) | |
| audit_log | no | SELECT +site | | No INSERT policy; only write path is `write_audit_log()` (SECURITY DEFINER, officer/team_leader/site_admin, [#214](https://github.com/katogaming88/WGA-Raid-Hub/issues/214)) |
| bis_items | yes | all ops | (via officer) | Team resolved through `players.team_id` subquery |
| bis_requests | no | SELECT +site, UPDATE +site | | No table INSERT policy; `submit_bis_link()` (SECURITY DEFINER) is the only write path ([#404](https://github.com/katogaming88/WGA-Raid-Hub/issues/404)) |
| classes_specs | yes | | | Read-only lookup; no write policy |
| item_bosses | yes | | | Read-only lookup; no write policy |
| items | yes | | | Read-only lookup; no write policy |
| mplus_exclusion_requests | no | SELECT +site, UPDATE +site | | No table INSERT policy; `submit_mplus_exclusion()` (SECURITY DEFINER) is the only write path ([#405](https://github.com/katogaming88/WGA-Raid-Hub/issues/405)) |
| player_wcl_season_perf | yes | all ops | (via officer) | |
| players | yes | all ops | (via officer) | |
| priority_order | yes | all ops | (via officer) | |
| rclc_loot | yes | all ops | (via officer) | |
| scoring | yes | all ops | (via officer) | Team resolved through `players.team_id` subquery |
| season_signups | no | SELECT +site, UPDATE +site | | No table INSERT policy; `submit_season_signup()` (SECURITY DEFINER) is the only write path ([#403](https://github.com/katogaming88/WGA-Raid-Hub/issues/403)) |
| self_received_requests | no | SELECT +site, UPDATE +site | | No table INSERT policy; `submit_self_received()`/`direct_mark_received()` (both SECURITY DEFINER) are the only write paths ([#406](https://github.com/katogaming88/WGA-Raid-Hub/issues/406)) |
| site_admins | no | | | Site admins only: SELECT and all ops via `is_site_admin()` |
| site_settings | yes | | | Singleton row (id=1); no write policy, `admin_set_maintenance_mode()` (SECURITY DEFINER) is the only write path ([#245](https://github.com/katogaming88/WGA-Raid-Hub/issues/245)) |
| streamers | yes | all ops | (via officer) | First self-service write policy in the schema ([#286](https://github.com/katogaming88/WGA-Raid-Hub/issues/286)): a raider can also INSERT/UPDATE/DELETE their own row via `is_own_player(player_id)`, independent of the officer/team-leader grant |
| team_members | no | SELECT +site | all ops +site | Members also read their own row (`auth_user_id = auth.uid()`) |
| team_settings | yes | | all ops +site | |
| teams | yes | | | Read-only lookup; no write policy |

## Views and functions

None of these carries a policy of its own. The view and the `SECURITY INVOKER` function defer to the table policies above; the `SECURITY DEFINER` function deliberately bypasses them for one specific, validated operation.

- **`pending_roster`** (view): the officer worklist of approved signups awaiting a roster add (`season_signups` where `status = 'approved'` and `approved_player_id is null`, joined to `classes_specs`). Created `WITH (security_invoker = on)`, so it runs with the caller's privileges and the `season_signups` policies apply to whoever queries it: anon and raiders see zero rows, officers and team leaders see their own team. SELECT is granted to `anon` and `authenticated`; the grant is safe because the underlying policies do the filtering.
- **`add_signup_to_roster(signup_id, is_trial, archive_player_id)`** (function): atomically promotes an approved signup to the roster (creates or unarchives the `players` row, optionally archives a main-swap predecessor on the same team, sets `status = 'added'` and `approved_player_id`). `SECURITY INVOKER`, so authorization comes entirely from the caller passing the existing `players` write and `season_signups` update policies. EXECUTE is granted to `authenticated` only and revoked from `anon` and `public`.
- **`claim_character(team_id, name_realm)`** (function): links a raider's chosen character to their person row, setting `players.team_member_id` and creating the `team_members` row (`role = 'raider'`) on a first claim, or reusing an unlinked row imported from the Discord Claims sheet ([#338](https://github.com/katogaming88/WGA-Raid-Hub/issues/338)). `SECURITY DEFINER` because a claiming raider has no role yet and cannot pass the `players` or `team_members` write policies; it validates that the character is an unarchived, unclaimed roster member of the team and derives the caller's Discord id from `auth.users` rather than trusting a parameter. EXECUTE is granted to `authenticated` only and revoked from `anon` and `public`.
- **`submit_self_received(team_id, name_realm, item_name, track, source, note)`** (function): a raider's self-received loot submission, inserting `pending` unless the caller is authenticated as the named character (`players.team_member_id -> team_members.auth_user_id = auth.uid()`), in which case it inserts `approved` immediately ([#406](https://github.com/katogaming88/WGA-Raid-Hub/issues/406)). `SECURITY DEFINER` because `self_received_requests` has no INSERT policy for anyone. EXECUTE is granted to `anon` and `authenticated`.
- **`direct_mark_received(team_id, name_realm, item_name, track, source, note)`** (function): an officer marking an item received on a raider's behalf, bypassing the approval queue -- inserts `approved` directly ([#406](https://github.com/katogaming88/WGA-Raid-Hub/issues/406)). `SECURITY DEFINER`, checking `my_team_role()`/`is_site_admin()` in the function body since (like `submit_self_received`) there's no INSERT policy to lean on. EXECUTE is granted to `authenticated` only and revoked from `anon` and `public`.

## Known issues

- `service_role` is missing base DML grants on every table, the same defect [#284](https://github.com/katogaming88/WGA-Raid-Hub/issues/284) fixed for `anon` and `authenticated`. service_role bypasses policies but not grants, so server-side writes (Edge Functions, service-key integrations) will fail until it gets the same treatment. Flagged on #284.

## Verifying against a live database

The raw, ungrouped policy list (one row per policy, straight from `pg_policies`) is committed as [rls_policies.csv](rls_policies.csv), which opens in any spreadsheet tool for sorting and filtering. Regenerate it with `npm run db:rls` (stack running); CI fails a PR when the committed CSV no longer matches what the migrations produce. For interactive browsing, local Supabase Studio (http://127.0.0.1:54323) has a Policies page showing each table's policies with their SQL.

The same list, ad hoc in psql:

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

The vitest RLS policy-matrix harness in [`tests/rls/`](../tests/rls/) exercises these policies with impersonated anon, raider, officer, team leader, and site admin sessions and is the executable form of this document. Run it with `supabase db reset` then `npm run test:rls`.
