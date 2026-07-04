# Database Decisions Log

A running record of settled database/schema decisions and the reasoning behind them. Each entry links back to the GitHub issue comment with the full discussion -- this log is a summary and index, not a replacement for that context.

Issues carrying a decision are tagged with the `decision` label: `gh issue list --label decision --state all`.

---

## #250 -- Schema audit: Phase 1 review

- **Seasons table.** Adding a `seasons` lookup table (`slug` PK, `name`, `starts_at`, `ends_at`) instead of a format CHECK on `season text` columns. A CHECK can't catch a well-formed typo (`MN11` vs `MN1`); only an FK against a canonical table can. `ends_at IS NULL` also gives "current season" for free, which the priority generator and #143 (archived seasons) both need.
- **team_settings / season_snapshots SELECT policy.** Locked down to team members only (`my_team_role(team_id) is not null`). Both tables carry data with no reason to be publicly readable, unlike roster/loot which the public site intentionally exposes.
- **attendance FK on-delete.** Changed `attendance.player_id` to `ON DELETE SET NULL` (was `CASCADE`), matching `rclc_loot`. Soft-delete (`players.archived_at`, decided in #258) is the primary path; this FK change is the safety net if a hard-delete ever happens anyway.
- **Auth-link backfill.** Added an `AFTER INSERT` trigger on `team_members` and `site_admins` that backfills `auth_user_id` immediately if the person already has an `auth.users` row (covers the case where someone logs in via Discord before an officer seeds their row).

[Full discussion -> #250](https://github.com/katogaming88/WGA-Raid-Hub/issues/250)

---

## #257 -- Schema hardening (constraints, timestamps, triggers)

Umbrella issue. Original scope, later split into #262 (nullability/duplicate guards), #266 (updated_at), #267 (team_id consistency trigger):

- Unique constraints: `attendance(team_id, player_id, raid_date)`, `bis_items(player_id, item_id)`, `priority_order(team_id, season, item_id, difficulty, player_id)`, `priority_order(team_id, season, item_id, difficulty, rank)`, `item_bosses(item_id, boss)`, `classes_specs(class, spec)`, `teams.slug`.
- CHECK constraints on status/enum-like columns across `season_signups`, `attendance`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `rclc_loot.difficulty`, `priority_order.difficulty`, `classes_specs.role`, `items.armor_type`.
- **Original updated_at table list:** `players`, `bis_items`, `priority_order`, `team_members`, `team_settings`, `season_signups`. (Note: this list drifted when #266 was spun out -- see that entry and #272.)
- **Original team_id trigger table list:** `attendance`, `rclc_loot`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `priority_order` (six tables -- see #267/#271 for how `priority_order` got dropped along the way).

[Full discussion -> #257](https://github.com/katogaming88/WGA-Raid-Hub/issues/257)

---

## #258 -- Scoring, WCL data, and identity design decisions

- **scoring table:** add `season text NOT NULL`, unique key becomes `(player_id, season)`. Additive per season instead of overwritten, for trend analysis and priority generation.
- **player_wcl_season_perf (new table):** separate from `scoring` -- different source (WCL character API vs. team reports), different update cadence (once per season vs. per raid import). Holds `best_perf_avg` / `median_perf_avg` fetched at season start, used as the heroic priority baseline until current-season `scoring` data accumulates.
- **Identity/lifecycle fix:** `players.team_member_id` (FK -> `team_members.id`, nullable) links a character row to the person/Discord account. `players.archived_at` (soft-delete) preserves character history across a main-swap instead of losing it to a hard-delete. `season_signups.approved_player_id` (FK -> `players.id`, `ON DELETE SET NULL`) links a signup to the character it produced.
- **Season-scoping of wipe-between-seasons tables:** `scoring` gets a `season` column (preserve history). `mplus_exclusion_requests` and `bis_items` do NOT -- both wipe between seasons on purpose (gear/tier resets the exclusion criteria and BiS lists are rebuilt fresh each tier), and that intent is written down here so it isn't mistaken for a bug later.

[Full discussion -> #258](https://github.com/katogaming88/WGA-Raid-Hub/issues/258)

---

## #262 -- Nullability + duplicate-guard hardening

- `bis_items.item_id` and `mplus_exclusion_requests.player_id` set `NOT NULL` (both tables empty at the time, no backfill cost).
- `mplus_excl_one_pending_per_player` partial unique index (`(player_id) where status = 'pending'`) replaces the dropped `(player_id, week_of)` constraint -- one open request per player, resolved rows stay as history.
- **priority_order rank-reorder safety -- Option B (delete + reinsert).** The `(team_id, season, item_id, difficulty, rank)` unique constraint fails mid-statement on bulk re-rank updates (Postgres checks row-by-row). Decided to have the app delete + reinsert the full list per reorder, rather than making the constraint `DEFERRABLE`. **Scope note:** this decision applies only to the reorder app logic, which doesn't exist yet (the priority list feature is still GAS/Sheets-based) -- it does NOT apply to schema/trigger work on `priority_order`, which should proceed independent of when the reorder UI gets built. See [[project_priority_order_migration]] in memory and #271 for why this distinction matters.

[Full discussion -> #262](https://github.com/katogaming88/WGA-Raid-Hub/issues/262)

---

## #266 -- updated_at timestamps

- Added `updated_at timestamptz` + shared `set_updated_at()` BEFORE UPDATE trigger to six tables: `players`, `season_signups`, `bis_items`, `scoring`, `mplus_exclusion_requests`, `priority_order`.
- **Nullable, no default.** A freshly inserted row has `updated_at = NULL` until its first real update. None of these tables (aside from `season_signups`, which has `submitted_at`) have a separate created-at column, so leaving `updated_at` null at insert is what lets you tell "never edited since creation" apart from "edited at time X." (The original #266 write-up justified this as "no backfill needed," which isn't accurate -- `NOT NULL DEFAULT now()` backfills for free on `ADD COLUMN` -- the real reason is the one above; corrected in #272.)
- **Table list note:** this six-table list does not match #257's original list (`team_members` and `team_settings` were dropped, `scoring` and `mplus_exclusion_requests` were added). No comment anywhere explains the swap -- see #272, where the omission of `team_members`/`team_settings` was confirmed as unintentional and fixed.

[Full discussion -> #266](https://github.com/katogaming88/WGA-Raid-Hub/issues/266)

---

## #267 -- team_id consistency trigger

- Added `check_team_id_matches_player()` (BEFORE INSERT OR UPDATE) to five tables: `attendance`, `rclc_loot`, `bis_requests`, `self_received_requests`, `mplus_exclusion_requests`. Raises if the row's `team_id` doesn't match `players.team_id` for the given `player_id`; skips the check when `player_id` is null (allowed on `rclc_loot` after a player delete).
- `bis_items` intentionally excluded -- no denormalized `team_id`, derives team through the `player_id` FK by design.
- **`priority_order` was left off this list** despite being named in #257's original six-table scope. Confirmed a plain implementation oversight, not a deliberate exclusion -- fixed in #271.

[Full discussion -> #267](https://github.com/katogaming88/WGA-Raid-Hub/issues/267)

---

## #271 -- priority_order missing team_id consistency trigger

- Added `check_team_id_matches_player()` trigger to `priority_order` (table was empty, no backfill concern), bringing it in line with the other five tables from #267.

[Full discussion -> #271](https://github.com/katogaming88/WGA-Raid-Hub/issues/271)

---

## #272 -- updated_at coverage + nullable/default revisit

- **Coverage:** add `updated_at` + `set_updated_at()` trigger to `team_members` and `team_settings` too, matching #257's original scope. Both are clearly mutable (`role` changes, `auth_user_id` backfill, `name_realm` swaps on `team_members`; officer-edited `config` on `team_settings`) with no existing timestamp column, and no reason for the #266 omission was ever recorded.
- **Nullable/default:** confirmed keep nullable, no `DEFAULT now()` -- see the corrected rationale under #266 above.

[Full discussion -> #272](https://github.com/katogaming88/WGA-Raid-Hub/issues/272)
