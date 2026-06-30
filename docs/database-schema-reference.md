# Database Schema Reference

A full column-by-column breakdown of every table in the WGA Raid Hub database.
Includes notes on redundancies and why they exist.

---

## Table of Contents

- [items](#items)
- [item_bosses](#item_bosses)
- [bis_items](#bis_items)
- [rclc_loot](#rclc_loot)
- [priority_order](#priority_order)
- [season_signups](#season_signups)
- [attendance](#attendance)
- [players](#players)
- [team_members](#team_members)
- [teams](#teams)
- [team_settings](#team_settings)
- [season_snapshots](#season_snapshots)
- [audit_log](#audit_log)
- [site_admins](#site_admins)
- [scoring](#scoring)
- [classes_specs](#classes_specs)
- [self_received_requests](#self_received_requests)
- [bis_requests](#bis_requests)
- [mplus_exclusion_requests](#mplus_exclusion_requests)
- [Redundancies & Design Notes](#redundancies--design-notes)

---

## `items`

Master item catalog. Every loot piece the system knows about.

| Column           | Type | Purpose                                                                   |
| ---------------- | ---- | ------------------------------------------------------------------------- |
| `id`             | int4 | Internal PK used as FK everywhere else                                    |
| `wow_item_id`    | int4 | Blizzard's item ID (used for Wowhead links and tooltip lookups)           |
| `name`           | text | Display name of the item                                                  |
| `slot`           | text | Gear slot (e.g. "Head", "Trinket")                                        |
| `armor_type`     | text | Plate/Mail/Leather/Cloth -- used to filter BiS lists by class             |
| `sort_id`        | int4 | Controls display order within a slot                                      |
| `is_placeholder` | bool | Marks synthetic items added before real loot data exists (e.g. early PTR) |

---

## `item_bosses`

Maps each item to the boss(es) that drop it. Multi-row per item when the same item drops from multiple bosses.

| Column    | Type | Purpose                          |
| --------- | ---- | -------------------------------- |
| `item_id` | int4 | FK -> `items.id`                 |
| `boss`    | text | Boss name string (e.g. "Onyxia") |

---

## `bis_items`

A player's current BiS list -- which items they need and whether they have them.

| Column      | Type | Purpose                                 |
| ----------- | ---- | --------------------------------------- |
| `id`        | int4 | PK                                      |
| `player_id` | int4 | FK -> `players.id`                      |
| `item_id`   | int4 | FK -> `items.id` -- the item they want  |
| `obtained`  | bool | Whether they have received it this tier |

---

## `rclc_loot`

Raw loot history imported from the RCLootCouncil addon export.

| Column       | Type        | Purpose                                                                                |
| ------------ | ----------- | -------------------------------------------------------------------------------------- |
| `id`         | int4        | PK                                                                                     |
| `team_id`    | int4        | FK -> `teams.id` -- denormalized for query filtering and RLS                           |
| `player_id`  | int4        | FK -> `players.id`                                                                     |
| `item_id`    | int4        | FK -> `items.id`                                                                       |
| `difficulty` | text        | Raid difficulty the item dropped in (Normal/Heroic/Mythic)                             |
| `season`     | text        | Season string (e.g. "MN1")                                                             |
| `awarded_at` | timestamptz | Timestamp of loot award                                                                |
| `rclc_id`    | text        | RCLootCouncil's own record ID -- primary deduplication key on re-import                |
| `dedupe_key` | text        | Composite hash (player + item + date) -- fallback deduplication when rclc_id is absent |
| `boss`       | text        | Boss the item dropped from at time of award (event-level record, not a lookup)         |

---

## `priority_order`

Ordered loot priority lists managed by officers -- who gets the next drop for a given item.

| Column       | Type | Purpose                                   |
| ------------ | ---- | ----------------------------------------- |
| `id`         | int4 | PK                                        |
| `team_id`    | int4 | FK -> `teams.id`                          |
| `season`     | text | Season this priority list applies to      |
| `item_id`    | int4 | FK -> `items.id`                          |
| `difficulty` | text | Difficulty tier this priority applies to  |
| `rank`       | int4 | Ordinal position (1 = next in line)       |
| `player_id`  | int4 | FK -> `players.id` -- who is at this rank |

---

## `season_signups`

Applications submitted by players (or prospective members) to join a raid team for a season.

| Column                | Type        | Purpose                                                                          |
| --------------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`                  | int4        | PK                                                                               |
| `team_id`             | int4        | FK -> `teams.id`                                                                 |
| `signup_name_realm`   | text        | Character name-realm as entered by the applicant (free text -- no player FK yet) |
| `off_specs`           | text        | Off-specs they can play                                                          |
| `main_swap`           | bool        | Whether they want to swap mains from last season                                 |
| `player_note`         | text        | Free-text note from the applicant                                                |
| `submitted_at`        | timestamptz | When the signup was submitted                                                    |
| `status`              | text        | Workflow state: pending/approved/denied                                          |
| `swap_class_spec_id`  | int4        | FK -> `classes_specs.id` -- the new spec they would swap to                      |
| `season`              | text        | Which season this signup is for                                                  |
| `reviewed_at`         | timestamptz | When an officer acted on it                                                      |
| `reviewed_by`         | int4        | FK -> `players.id` (officer who reviewed)                                        |
| `signup_officer_note` | text        | Officer's internal note on the application                                       |

---

## `attendance`

Per-player, per-raid-night attendance records.

| Column            | Type | Purpose                                                                       |
| ----------------- | ---- | ----------------------------------------------------------------------------- |
| `id`              | int4 | PK                                                                            |
| `team_id`         | int4 | FK -> `teams.id` -- denormalized for filtering and RLS                        |
| `player_id`       | int4 | FK -> `players.id`                                                            |
| `raid_date`       | date | Date of the raid night                                                        |
| `status`          | text | Present/Absent/Late/Bench/Excused                                             |
| `report_excluded` | bool | Whether this record is excluded from attendance reports (e.g. cancelled raid) |
| `report_id`       | text | External report identifier (Warcraft Logs report ID)                          |

---

## `players`

The active raid roster. One row per character on a team.

| Column            | Type | Purpose                                              |
| ----------------- | ---- | ---------------------------------------------------- |
| `id`              | int4 | PK                                                   |
| `team_id`         | int4 | FK -> `teams.id`                                     |
| `name_realm`      | text | "CharName-RealmName" -- canonical character identity |
| `class_spec_id`   | int4 | FK -> `classes_specs.id`                             |
| `is_trial`        | bool | Whether they are on trial (affects loot and scoring) |
| `is_bench`        | bool | Bench player flag                                    |
| `nickname`        | text | Display name override shown in the UI                |
| `bis_link`        | text | URL to their external BiS list (Wowhead, etc.)       |
| `join_date`       | date | When they joined the roster                          |
| `m_plus_excluded` | bool | Whether they are excluded from M+ tracking           |
| `m_plus_note`     | text | Reason for M+ exclusion                              |

---

## `team_members`

Links Discord/auth users to a team. The account-level membership layer, separate from the character roster.

| Column         | Type | Purpose                                                                       |
| -------------- | ---- | ----------------------------------------------------------------------------- |
| `id`           | int4 | PK                                                                            |
| `team_id`      | int4 | FK -> `teams.id`                                                              |
| `discord_id`   | text | Discord user snowflake -- used for auth and notifications                     |
| `auth_user_id` | uuid | FK -> `auth.users.id` (Supabase auth)                                         |
| `role`         | text | Team role: officer/member/viewer                                              |
| `name_realm`   | text | The character this member considers their main (see note on redundancy below) |

---

## `teams`

Top-level tenant. One row per raid team.

| Column | Type | Purpose                            |
| ------ | ---- | ---------------------------------- |
| `id`   | int4 | PK                                 |
| `name` | text | Display name of the team           |
| `slug` | text | URL-safe identifier used in routes |

---

## `team_settings`

Key-value config blob per team. One row per team.

| Column    | Type  | Purpose                                                                    |
| --------- | ----- | -------------------------------------------------------------------------- |
| `team_id` | int4  | PK + FK -> `teams.id`                                                      |
| `config`  | jsonb | Freeform settings (loot rules, scoring weights, display preferences, etc.) |

---

## `season_snapshots`

Point-in-time snapshots of team state at the end of or during a season.

| Column       | Type        | Purpose                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| `id`         | int4        | PK                                                                     |
| `team_id`    | int4        | FK -> `teams.id`                                                       |
| `season`     | text        | The season being snapshotted                                           |
| `snapped_at` | timestamptz | When the snapshot was taken                                            |
| `data`       | jsonb       | Full serialized team state (roster, scores, loot, etc.) at that moment |

---

## `audit_log`

Immutable event log of officer actions for accountability.

| Column        | Type        | Purpose                                                     |
| ------------- | ----------- | ----------------------------------------------------------- |
| `id`          | int4        | PK                                                          |
| `team_id`     | int4        | FK -> `teams.id`                                            |
| `actor_id`    | uuid        | FK -> `auth.users.id` -- who performed the action           |
| `action`      | text        | Action type string (e.g. "loot_awarded", "player_promoted") |
| `target_type` | text        | Entity type affected (e.g. "player", "item")                |
| `target_id`   | int4        | PK of the affected entity                                   |
| `detail`      | jsonb       | Before/after values or extra context for the action         |
| `created_at`  | timestamptz | When the action occurred                                    |

---

## `site_admins`

Global super-admins who can manage any team on the site. Separate from team-scoped membership.

| Column         | Type | Purpose                    |
| -------------- | ---- | -------------------------- |
| `id`           | int8 | PK                         |
| `discord_id`   | text | Discord snowflake for auth |
| `auth_user_id` | uuid | FK -> `auth.users.id`      |

---

## `scoring`

Cached computed scores per player. Denormalized for fast UI rendering -- all values are derivable from `attendance` and `rclc_loot`.

| Column              | Type    | Purpose                                                           |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `id`                | int4    | PK                                                                |
| `player_id`         | int4    | FK -> `players.id`                                                |
| `recent_score`      | numeric | Score based on recent raid performance (recency-weighted)         |
| `trend_score`       | numeric | Score trajectory -- whether performance is improving or declining |
| `best_score`        | numeric | All-time or current-tier peak score                               |
| `performance_score` | numeric | Parse/performance component of overall score                      |
| `attendance_score`  | numeric | Attendance component of overall score                             |
| `attendance_pct`    | numeric | Raw attendance percentage (separate from the weighted score)      |

---

## `classes_specs`

Lookup table of every valid WoW class/spec combination.

| Column  | Type | Purpose                                                   |
| ------- | ---- | --------------------------------------------------------- |
| `id`    | int4 | PK                                                        |
| `class` | text | Class name (e.g. "Paladin")                               |
| `spec`  | text | Spec name (e.g. "Holy")                                   |
| `role`  | text | Tank/Healer/DPS -- drives buff coverage and comp analysis |

---

## `self_received_requests`

Player-submitted claims that they received a drop (self-reported loot tracking, pending officer approval).

| Column         | Type        | Purpose                                              |
| -------------- | ----------- | ---------------------------------------------------- |
| `id`           | int4        | PK                                                   |
| `team_id`      | int4        | FK -> `teams.id` (denormalized)                      |
| `player_id`    | int4        | FK -> `players.id`                                   |
| `self_item_id` | int4        | FK -> `items.id` -- item they claim to have received |
| `submitted_at` | timestamptz | When they submitted the claim                        |
| `status`       | text        | Pending/approved/denied by an officer                |

---

## `bis_requests`

Player requests to be added to the BiS list for a specific item (officer-approval workflow).

| Column            | Type        | Purpose                                                  |
| ----------------- | ----------- | -------------------------------------------------------- |
| `id`              | int4        | PK                                                       |
| `team_id`         | int4        | FK -> `teams.id` (denormalized)                          |
| `player_id`       | int4        | FK -> `players.id`                                       |
| `bis_req_item_id` | int4        | FK -> `bis_items.id` -- the BiS list link change request |
| `submitted_at`    | timestamptz | When the request was made                                |
| `status`          | text        | Pending/approved/denied                                  |

---

## `mplus_exclusion_requests`

Requests to be excluded from M+ score tracking for a given week.

| Column          | Type        | Purpose                                                |
| --------------- | ----------- | ------------------------------------------------------ |
| `id`            | int4        | PK                                                     |
| `team_id`       | int4        | FK -> `teams.id` (denormalized)                        |
| `player_id`     | int4        | FK -> `players.id`                                     |
| `week_of`       | date        | The M+ lockout week this exclusion applies to          |
| `reason`        | text        | Player-provided reason                                 |
| `submitted_at`  | timestamptz | When it was submitted                                  |
| `status`        | text        | Pending/approved/denied                                |
| `raiderio_url`  | text        | Raider.IO profile link for officer to verify key count |
| `officer_notes` | text        | Internal officer note on the decision                  |

---

## Redundancies & Design Notes

### 1. `rclc_loot.boss` vs `item_bosses.boss`

Both store a boss name as free text but serve different purposes. `item_bosses` is a curated static mapping of what boss an item _can_ drop from. `rclc_loot.boss` is the boss recorded _at the moment loot was awarded_ from the addon export -- it is event-level historical data. The loot row captures what actually happened; the item mapping captures current design knowledge. If `item_bosses` were always complete and accurate, `rclc_loot.boss` could theoretically be derived, but it's kept on the loot row for import fidelity.

### 2. `rclc_id` vs `dedupe_key` in `rclc_loot`

Both exist for deduplication on re-import but handle different failure modes. `rclc_id` is the addon's own ID -- reliable when present. `dedupe_key` is a composite hash (player + item + date) we control, acting as a fallback when `rclc_id` is absent or potentially unreliable. Having both makes re-imports robust against either field being malformed.

### 3. `team_id` denormalized across many tables

`attendance`, `rclc_loot`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `season_signups`, and `priority_order` all carry `team_id` even though `player_id` already implies a team via `players.team_id`. This is intentional denormalization for two reasons: (1) it avoids joining through `players` on every query, and (2) it allows Supabase Row-Level Security policies to filter by team directly on these tables. The tradeoff is that `team_id` could drift out of sync with `players.team_id` if a player is transferred between teams.

### 4. `players.name_realm` vs `team_members.name_realm`

These look like the same field but represent different layers. `players.name_realm` is the roster character (the actual raider). `team_members.name_realm` is the character a Discord account has linked to themselves for identity purposes. A team member's linked character might not match any roster player (e.g. an officer managing from the bench, or a prospective applicant). They will often be the same string but are conceptually distinct.

### 5. `site_admins` vs `team_members` sharing `discord_id` and `auth_user_id`

These fields appear in both tables but are not redundant -- they serve different scopes. `team_members` is team-scoped membership; `site_admins` is a global super-admin check that must work without joining through any team. Keeping them in a separate table also prevents a site admin from implicitly appearing as a member of every team.

### 6. `self_received_requests` vs `bis_requests` -- similar structure, different workflows

These two tables are structurally nearly identical (team_id, player_id, item FK, submitted_at, status) but model two distinct officer workflows:

- `self_received_requests`: "I received a drop -- please mark it obtained on my BiS list." The item FK points to `items`.
- `bis_requests`: "Please change the link for my bis list & update my bis items." The item FK points to `bis_items` (a BiS list entry, not just an item).

They are similar enough that they could be merged with a `type` discriminator, but keeping them separate gives each its own RLS, officer queue, and history without conditional logic.

### 7. `scoring` -- fully derived/cached data

Every column in `scoring` can be computed from `attendance` and `rclc_loot` using the scoring formula. The table exists purely as a write-through cache so leaderboard and roster pages avoid expensive aggregations on every load. The main risk is staleness: if attendance or loot records change without re-running the scoring job, these numbers will drift out of sync with reality.
