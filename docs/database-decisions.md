# Database Decisions Log

A running record of settled database/schema decisions and the reasoning behind them. Each entry links back to the GitHub issue comment with the full discussion -- this log is a summary and index, not a replacement for that context.

Issues carrying a decision are tagged with the `decision` label: `gh issue list --label decision --state all`.

---

## 2026-07-09 -- Audit log write path: security-definer writer is the only insert path

`audit_log` grants anon/authenticated only `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` -- no `INSERT` -- so a Phase 5 officer write feature has no direct path to log an action. `write_audit_log(p_team_id, p_action, p_target_type, p_target_id, p_detail)` (migration `20260709120000_write_audit_log.sql`) is the one function meant to ever insert into that table.

- **Same SECURITY DEFINER shape as `is_site_admin()`, `link_auth_user_to_member()`, `claim_character()`:** `plpgsql`, `set search_path to 'public'`, identity read directly from `auth.uid()` rather than a passed-in parameter, so a caller can't attribute an action to someone else.
- **`actor_id` is always `auth.uid()`**, never a caller-supplied value -- matches the column's FK to `auth.users` and keeps attribution trustworthy regardless of what the caller passes as arguments.
- **Gate is officer/team_leader-or-site-admin**, via `my_team_role(p_team_id) in ('officer', 'team_leader')` or `is_site_admin()` -- the same pair every other officer-tier policy in this schema checks (post-#294 rename; the value is no longer `admin`).
- **Every future Phase 5 officer-write RPC should follow this same shape** (security definer, `auth.uid()`-derived actor, officer/team_leader-or-site-admin gate) instead of re-deciding the pattern per call site. Wiring existing write flows (roster edits, BiS approvals, loot marks, still on the legacy Apps Script backend) onto this function is out of scope for #214 and left for those flows' own migration issues.

[Full discussion -> #214](https://github.com/katogaming88/WGA-Raid-Hub/issues/214)

---

## 2026-07-08 -- Loot attributes to characters; unknown loot names become archived stubs

The loot importer previously kept rows whose player name no longer matched the Roster with `player_id` null (67 of phoenix's 156 imported rows, spanning 24 departed characters). Any player-keyed view drops such rows, and the Supabase loot read (#209) is player-keyed, so those rows would have vanished from the site's loot totals and Recent Loot feed.

- **Unknown loot names now become archived stubs**, through the same `registry.resolveOrStub` path attendance and scoring always used: a departed character gets a `players` row with `archived_at` set and no class/spec, and the loot row points at it. A one-time relink script backfilled the pre-stub prod rows (stub inserts, then `player_id` updates keyed on `dedupe_key`, which embeds the normalized name-realm).
- **Layering principle:** `players` rows are characters; `team_members` is the person (Discord) layer; `players.team_member_id` links them, many characters to one person. Loot attribution stays character-level -- the historical fact of who the item dropped to. Person-level grouping (mainswaps, alts, same-name characters played by one human) is a `team_member_id` linking exercise through the claims flow and officer tooling, never a loot-schema change.
- The Snarge precedent holds: two characters sharing a first name stay two rows; whether one human plays both is person-layer information.

[Loot read switch -> #209](https://github.com/katogaming88/WGA-Raid-Hub/issues/209)

---

## 2026-07-07 -- Loot columns store item track, named and valued as track (Champion/Hero/Myth)

The `difficulty` columns on `rclc_loot`, `self_received_requests`, and `priority_order` were renamed to `track` with values `Champion`/`Hero`/`Myth` (migration `20260707221243_track_vocabulary`).

- **The semantic was always the item's upgrade track, not the raid difficulty.** The GAS app translated Normal-difficulty drops to "champion", and `self_received_requests` uses the same values for M+ vault, crafted, and catalyst items that never dropped at any raid difficulty. The #320 B2 decision kept "Heroic"/"Mythic" as convenience labels ("lines up with the instance difficulty made it easier"); #343 finished the thought by adopting the real track names, and kat confirmed the column "was only called difficulty because of it being derived from the Instance column."
- **RCLC input maps deterministically for raid drops** (Normal -> Champion, Heroic -> Hero, Mythic -> Myth, from the instance string's suffix). The RCLC itemString's bonus IDs encode the track authoritatively and are the preferred source for the Phase 5 ongoing import (#219).
- **`priority_order` allows only Hero/Myth, permanently.** Champion loot drops in the first weeks of a raid and is handed out by loot council (via RCLC's roll column), never through the priority system.

[Full discussion -> #343](https://github.com/katogaming88/WGA-Raid-Hub/issues/343)

---

## 2026-07-06 -- Pending roster is a season_signups state, not a players flag

The old sheet's "Pending Roster" tab (approved applicants waiting for the roster add) needed a database home. The candidate designs were a marker column on `players` (`is_pending boolean` or `rostered_at timestamptz`, with the player row created at approve time) versus keeping the whole staging phase inside `season_signups`.

- **Chosen: no `players` row until the roster add.** Pending roster is exactly `season_signups` with `status = 'approved'` and `approved_player_id IS NULL`. The UI reads it through the `pending_roster` view (`security_invoker = on`, so the officer-only `season_signups` policies apply to callers). Promotion is `add_signup_to_roster(signup_id, is_trial, archive_player_id)`, a `SECURITY INVOKER` function that creates or unarchives the player, optionally archives a main-swap predecessor, and flips the signup to `added` in one transaction. A one-directional CHECK (`season_signups_player_only_when_added`) guarantees only `added` rows link to a player, while still tolerating the FK's `ON DELETE SET NULL`.
- **Promotion upsert has three cases** on `(team_id, name_realm)`: new character (plain insert, trial by default, `join_date = current_date`); returning archived character (unarchive the old row, refresh spec/trial/join_date, keep the same `players.id` so loot and attendance history stays attached); already-active member (link and update spec only, preserving their existing `is_trial` and `join_date`).
- **Rejected: marker column on `players`.** Four reasons. (1) `players` is public-read (`USING (true)`), so approve-time creation leaks applicant names to anonymous API callers unless the public policy is rewritten and every existing row backfilled; signup data is officer-only today. (2) It duplicates state `season_signups.status` already holds, and Postgres cannot enforce a cross-table invariant without trigger sync between two officer-writable tables, so the copies drift. (3) A pending player row can silently acquire attendance/loot/scoring rows through the name-matching importers. (4) A returning character's archived row collides with `UNIQUE (team_id, name_realm)` at approve time, and dismissing a pending player has no good answer (hard-delete contradicts #258's soft-delete, archiving pollutes history with characters that never raided). Deferring creation makes all of these unrepresentable.

---

## 2026-07-05 -- Schema documentation: generated with tbls, not hand-drawn

Triggered by losing a hand-arranged Supabase schema visualizer layout: the visualizer stores table positions in browser localStorage, per device, so it can never serve as documentation.

- **Generated over hand-drawn.** A hand-drawn diagram drifts from the migrations, and a stale diagram is worse than none. The migration SQL is already the source of truth, so the diagram is generated from it: `tbls` introspects the local stack and writes `dbdoc/` (markdown plus Mermaid ER), and a CI job fails any PR where `dbdoc/` no longer matches the schema. Regenerate with `npm run db:docs`.
- **Mermaid over SVG.** Renders natively on GitHub and diffs as text, so schema changes show up readably in PR review. SVG lays out prettier but commits unreviewable blobs.
- **RLS documented by hand.** tbls introspects structure, not policies, so `docs/RLS.md` carries the per-table policy matrix, with its own CI guard: a PR touching policy SQL must touch RLS.md.
- **Rejected: Supabase visualizer as documentation** (device-local localStorage) and **dbdiagram.io as source of truth** (canvas lives in their cloud; same one-browser trap, plus a second schema definition to keep aligned).

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

---

## #283 -- Roster "Priority" column's RL/Officer values are legacy, no migration needed

- The GAS Roster sheet's `Priority` column is documented as `1=RL, 2=Officer, 3=Tank, 4=Heal, 5=DPS, 6=Bench`, but every write path (`roleToPriority()`) only ever produces `3`/`4`/`5`/`6` -- nothing in the app has ever written `1` or `2`. Officer status is tracked entirely separately (Discord ID list today, `team_members.role` in the new schema).
- Confirmed with Kat: "RL" was never a distinct app concept, just a manual Sheet-only sort aid; a raid leader is almost always (not by rule) also an officer, and no dashboard permission or display logic has ever depended on it.
- **Decision:** no RL concept needs a home anywhere in the new schema. The already-migrated `players` table correctly has no equivalent column (role derives from `class_spec_id`, bench is its own `is_bench` boolean). Any leftover `1`/`2` in a live Sheet row is dead data with nothing to carry over.
- This also closes out this specific instance of the migration plan's open "does any officer hand-edit the Sheet in a way the dashboard can't do?" question -- no gap found.

[Full discussion -> #283](https://github.com/katogaming88/WGA-Raid-Hub/issues/283)

---

## #294 -- Permission tier names: raider / officer / team_leader, plus site_admin

- The word "admin" meant two unrelated things: the top per-team role in `team_members.role`, and the global `site_admins` table. No doc defined the difference, and `docs/supabase-setup-guide.md` lumped officer and admin into one tier even though three write policies separate them (`team_settings`, `team_members`, `season_snapshots`).
- **Decision:** the stored per-team role value `admin` is renamed to `team_leader`; the global tier is always written `site_admin`. Bare "admin" appears nowhere in docs or UI copy. The rename shipped as a migration that updates the stored values, the CHECK constraint, and all 20 policies that referenced the old literal (the three "Admins write ..." policies are now "Team leaders write ...").
- Live data confirmed the tier is load-bearing before renaming: each team has exactly one `team_leader` row, and two of the three are NOT site admins, so the role cannot be replaced by `site_admins` without over-granting.
- The UI will honor the officer/team-leader split when the frontend moves to Supabase; that scope (which Admin-tab panels tighten, which stay officer-level) is recorded in #317.

[Full discussion -> #294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294)
