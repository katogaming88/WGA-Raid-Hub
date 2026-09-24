# Season inventory

Every place the database and the code hold a season, read at commit `d206bea` (main, 2026-09-14) and measured against production the same evening. This is the input to the Season milestone (#932 to #939): it answers, per column and per config key, who writes it, who reads it, which format it holds, whether it means the guild's raid tier or one team's own cycle, and what the next tier does to it if nothing changes. Filed as #931. The decisions it records rather than re-opens are milestone 29's (2026-09-05): a BoE find borrows the guild's tier, the wishlist follows the team's cycle, and a team with no open cycle takes no wishlist submissions.

## How to read this

**Since #932 (2026-09-14, `20260914224520_seasons_table.sql`) the tier is a table.** `seasons` holds one row per raid tier, every column in section 2 is a foreign key to it (the code columns to `code`, the name columns to `display_name`, values unchanged). Nothing reads which tier is current yet: `raid_zones` keeps the syncing team's `seasonName` as its stamp, because the row is shared per zone and season and the site scopes a team's progress by that name (section 2), and a team with no name is skipped rather than stamped `Unknown`. The entries below stand as the reading they were, at the commit and date in the first line; a sentence saying no key or no table exists describes that reading.

**Since #933 (2026-09-20, `20260920130020_raid_zones_season_codes.sql`) `raid_zones.season` holds the code and references `seasons(code)`, `seasonView` holds a code, and the current tier has a definition: `current_season(p_on date)`, the latest tier whose start has passed on that day.** Under decision 13 on #1189 (the season is app-wide) `wcl-progression-sync` stamps a raid it has not filed before with it, read once per run, for every team (a raid already on file keeps its tier), and a team with no `seasonName` syncs; `fill_raid_night()` joins on the code; the site's scope check, the bonus roll list and the BoE picker compare zones by code, and `resolveSeasonViewCode()` returns a code on both branches while `resolveSeasonView()` returns a name for the two row stamps that still hold names; the app's editor carries the code for the zones and the name for the stamp, and the calendar's `seasonOn()` answers with the code. The entries below keep their 2026-09-14 reading.

**Since #937 (2026-09-20, `20260920160630_boe_items_season_codes.sql`) `boe_items.season` holds the code and references `seasons(code)`, and `submit_boe_found()` stamps `current_season()` whatever the reporting team's settings say**, since a BoE is guild property and the season is app-wide; the null rows took the tier current on the day each was found. The `boe.html` picker reads the same function at page load and offers that tier's BoEs for every team, no longer reading `team_settings` for a season or following the team picked. The importer wrote the name its `--seasons` file carried until #938's second pull request, which stamps the range's code and opens the generated file with a check that every stamped code is a `seasons` row.

**Since #935 (2026-09-20, `20260920234054_retire_bis_items.sql`) `bis_items` is gone**, and with it the one season column that was never going to convert; section 2 counts thirteen.

**Since #938 (2026-09-21, four pull requests: `20260921192826_cleanups_read_current_season.sql`, `20260921194720_close_season.sql`, `20260921201717_retire_season_name.sql`) `seasonName` is gone from `team_settings.config`, and nothing per team names the tier.** Every reader takes the tier: `current_season()` in the two stale-priority cleanups, `currentSeasonCode()` and `currentSeasonName()` (`js/common.js`, from the `seasons` read) on the site, and the app's `useCurrentSeason()` from the same table. `CURRENT_SEASON` left `js/common.js` with it. The archive became `close_season()`, which records a tier that has ended and starts nothing; the importer stamps codes. The season a team is on is the tier, so of section 3's per-team keys only the dates (#1269) and the planning override remain to convert. Sections 1, 3 and 4 below describe the state before it, where a line does not say otherwise.

**Since #936 (2026-09-24, `20260924003956_wishlist_season_codes.sql`) `item_preferences.season` holds the code and references `seasons(code)`, which was the last name column in section 2.** Nothing keys to `display_name` any more. Both writers stamp the code they already held for scoping: `wishlistUpsert()` reads `resolveSeasonViewCode()` (and stamps null rather than the empty string when no tier resolves), and the app's editor carries one value instead of a code and a name, so `resolveSeasonView()` and the app's `seasonName` in the wishlist module are both gone. No SQL reader filtered on the column before or after; #1268 is the one that will.

**Since #936 (2026-09-24, `20260924145125_wishlist_season_key.sql`) a wishlist pick is one per item, slot and season.** `item_preferences_no_dupe_item_key` gained `coalesce(season, '')`, so a raider holds a separate pick for the same item in each tier. Both editors read and write one tier with it: on the site every query for a raider's own picks goes through `wishlistScopeToSeason()` (`js/wishlist.js`), which is the read, the update, the remove and Clear All, and the insert stamps through `wishlistSeasonCode()`; in the app `picksInSeason()` (`app/src/profile/wishlist.ts`) scopes the editor's slots, its write plan and the Loot priority card's count. A row with no season is read as belonging to no tier rather than to the current one, which is the question the write gate already asked of it; on production that is the 9 rows on 2 archived characters. With no tier resolving at all, which means the seasons read failed, nothing narrows and the page goes read-only instead, so a raider sees every pick they hold rather than an empty wishlist. Still no SQL reader filtering on the column.

Season lives in three places today and none of them is a table.

- **The guild's raid tier.** Which tier is current is `CURRENT_SEASON` in `js/common.js`, a constant edited by hand once per tier. The database holds no guild-level season: `to_regclass('public.seasons')` and `('public.team_seasons')` are both null.
- **A team's cycle.** Which season a team is on is a set of keys on `team_settings.config`, written from the Season Settings tab. A team named its cycle after the tier it was raiding and dated it itself, so the two teams with a cycle started it a week apart (`seasonStart` 2026-08-11 and 2026-08-18) and two teams had no cycle at all (Immolation, Wrathless). Since #938 and #1269 neither is true: the season is the tier for every team, and its start is the team's own first raid night in that tier, derived by `team_season_start()` rather than typed.
- **The stamp on a row.** Fourteen tables carry a `season` column and nine views expose one. Not one column has a CHECK, a foreign key or a default. Eight unique or primary keys include the column, plus `tier_token_map`'s unique index.

Two formats are in use. The **code** (`MID1`, `MID2`) is the join and filter key. The **name** (`Midnight Season 1`, `Midnight Season 2`) is what officers see and type. `seasonCodeForDisplay()` and `seasonDisplayName()` in `js/common.js` convert between them through `SEASON_CODE_PREFIX` and `SEASON_DISPLAY_PREFIX`; `app/src/profile/profile.ts` carries a copy (`seasonCode()`, `seasonName()`); `add_signup_to_roster()` carries a third in SQL (a `regexp_replace` from `Midnight Season N` to `MIDN`).

**Tier or cycle** asks where the stamp came from, which is what decides each column's foreign key in #932 and its conversion in #933 to #938. *Cycle* means the value came from a team's own config (`seasonName`, `seasonView` or `activeSignupSeason`, directly or through `resolveSeasonView()` / `resolveSeasonViewCode()`). *Tier* means it came from a guild-wide source: a constant, a seed, or a raid's own membership in a tier. A cycle stamped in code form is written "cycle, as a tier code".

Entries name files and the function, view, trigger or constant inside them, never line numbers. Test files are not listed. Migrations appear where they seeded or backfilled a value. "By hand" means the dashboard's SQL Editor, which neither the migration ledger nor `audit_log` records.

## 1. Where the current tier lives today

| Where | What | Who reads it |
| --- | --- | --- |
| `CURRENT_SEASON` (`js/common.js`) | gone since #938's fourth pull request; was `{ code: 'MID2', displayName: 'Midnight Season 2' }`, edited once per tier | `executeArchiveSeason()` wrote its `displayName` into the team's `seasonName` until the third pull request, and `tierSeasonCode()` fell back to its `code` before team settings loaded (#1108); both read the `seasons` rows now |
| `SEASON_CODE_PREFIX`, `SEASON_DISPLAY_PREFIX` (`js/common.js`) | `'MID'`, `'Midnight Season'`; edited at an expansion boundary | `seasonCodeForDisplay()`, `seasonDisplayName()`, `_seasonDisplayPrefix()` (`js/tabs/tab-season.js`) |
| `SEASON_CODE_PREFIX`, `SEASON_DISPLAY_PREFIX` (`app/src/profile/profile.ts`) | the same two values, a second copy | `seasonCode()`, `seasonName()` in the new app |
| `SEASON` (`scripts/generate-tier-token-map-sql.js`) | `'MID2'`, the code the tier-token seed stamps | `tierTokenMapRows()` when the seed SQL is generated |
| `ZONE_ID`, `WCL_ZONE_ID` (`scripts/fetch-items.js`) | the tier's raid ids for the catalog import | the item rows the script writes (`items.wcl_zone_id`), which is how an item belongs to a tier |
| `raid_zones` | one row per raid per season name; the only table that ties a raid to a season | the scope check behind every wishlist, BiS and Priority view (section 2) |

Production, 2026-09-14: teams 1 and 2 (`phoenix`, `hellfire`) hold `seasonName = Midnight Season 2`, `seasonView` null, `activeSignupSeason = Midnight Season 2`, one archived entry each (`Midnight Season 1`); teams 3 and 4 (`immolation`, `wrathless`) hold no season key.

## 2. Table columns (13)

| Column | Null | Keys including it | Production rows | Format | Tier or cycle | Converts in |
| --- | --- | --- | --- | --- | --- | --- |
| `boe_items.season` | yes | none | 48 `Midnight Season 1`, 19 `Midnight Season 2`, 5 null | name | cycle (decided: tier) | #937 |
| `item_preferences.season` | yes | none | 3,361 `Midnight Season 2`, 9 null | name | cycle | #936 |
| `player_wcl_season_perf.season` | no | `unique (player_id, season)` | 46 `MID1` | code | cycle, as a tier code | #932 |
| `priority_conflict_dismissals.season` | no | `unique (team_id, player_id, season, boss, track)` | 26 `MID2` | code | cycle, as a tier code | #932 |
| `priority_order.season` | no | `unique (team_id, season, item_id, track, player_id)`, `unique (team_id, season, item_id, track, rank)` | 34 `MID1`, 1,629 `MID2` | code | cycle, as a tier code | #932 |
| `priority_order_confirmed_empty.season` | no | `primary key (team_id, season, item_id, track)` | 57 `MID2` | code | cycle, as a tier code | #932 |
| `priority_stale_dismissals.season` | no | `unique (team_id, player_id, season, item_id)` | 20 `MID2` | code | cycle, as a tier code | #932 |
| `raid_zones.season` | no | `unique (wcl_zone_id, season)` | 2 `Midnight Season 1`, 1 `Midnight Season 2` | name | tier, stamped from a cycle name | #933 |
| `rclc_loot.season` | yes | none | 168 `MID1`, 233 `MID2` | code | cycle, as a tier code | #932, #938 |
| `scoring.season` | no | `unique (player_id, season)` | 28 `MID1`, 83 `MID2` | code | cycle, as a tier code | #932 |
| `season_signups.season` | yes | none | 76 `Midnight Season 2`, 1 null | name | cycle (the next one) | #934 |
| `tier_token_map.season` | no | unique index `(season, token_item_id, class)` | 65 `MID2` | code | tier | #932 |
| `track_bonus_ids.season` | no | none | 19 `MID2` | code | tier (provenance only) | #932 |

### `bis_items.season`

Retired with the table in #935's second PR (2026-09-20, `20260920234054_retire_bis_items.sql`). The four rows, all `Midnight Season 1` on archived players, went with it.

### `boe_items.season`

- **Writers.** `submit_boe_found()` stamps the finder's team's `seasonName` at submit, null when that team has none (the five null rows; #922). The #320-era importer (`scripts/import/tables/boe.js`) stamps rows from `--seasons` date ranges through `seasonForDate()`, which answers with the range's code since #938 (before that its name, which the key on `seasons(code)` would refuse). The `check_boe_status_transition` trigger allows a direct update to change `season`; nothing sends one (the BoE Sales edit form in `js/boe-manage.js` never includes it). The lifecycle RPCs (`boe_record_listing`, `boe_record_sale`, `boe_mark_paid`, `boe_retire`, `boe_revert`) do not touch it.
- **Readers.** None. The BoE Sales page (`js/boe-manage.js`) does not select it; the found form and public page (`js/boe.js`) scope the item picker by `raid_zones.season` and the team's config, not by this column; `boe-webhook` and `boe-sold-webhook` do not select it; no view, function or app query reads it. Written, never read.
- **Format.** Name. **Meaning.** Cycle as written (the finder's team), which is the wrong owner for guild property: milestone 29 decided a find borrows the guild's tier.
- **Next tier, nothing changed.** A team that has not clicked Start New Season keeps stamping the old name, or null; nothing notices because nothing reads it. Converted in #937 (2026-09-20): the stamp is `current_season()` for every team, so the first find on or after the tier's start date carries the new code with no click.

### `item_preferences.season`

- **Writers.** `wishlistUpsert()` (`js/wishlist.js`) stamps `resolveSeasonView()` on insert; updates keep the row's stamp. The new app's `useMarkWishlist()` (`app/src/profile/useProfile.ts`) inserts the rows `app/src/profile/wishlist.ts` plans, stamped with the season name it was given (Season View if set, else the team's `seasonName`, from `useWishlistSettings()` and `useCurrentSeason()`). `20260725135340` backfilled the rows that existed. Deletes: `wishlistRemovePreference()`, `clearMyWishlist()`, and the app's `useMarkWishlist()`. `clearWishlistNote()` (`js/tabs/tab-priority.js`) and the `restrict_item_preferences_officer_update_to_note_clear` trigger touch `note` only. Closing a season (`close_season()`, and `archive_current_season()` before it) never clears this table.
- **Readers.** `fetchMyItemPreferences()` (`js/wishlist.js`), `fetchPlayerItemPreferences()` (`js/common.js`) and `fetchTeamItemPreferences()` (`js/tabs/tab-priority.js`) select it. `isItemInSeasonScope(name, p.season)` scopes placeholder picks by it in `bisMergeWishlistPrefs()` (`js/common.js`) and in `wishlistOtherSourceHTML()`, `wishlistOtherSourcesTaggedSlots()` and `wishlistOtherSourcesSectionHTML()` (`js/wishlist.js`); raid items scope by zone instead. The app's `useWishlist()` feeds `inSeason()` (`app/src/profile/lootPriority.ts`) and the placeholder checks in `app/src/profile/wishlist.ts`, which compare `pick.season` with the season name. No SQL reader by value: `generate_priority_order()`, `build_rclc_export()`, `wishlist_setup_status()` and `bis_demand_vs_awards` read the table without filtering on it.
- **Format.** Name. **Meaning.** Cycle: the wishlist follows the team's rollover (milestone 29, decision 3), and nothing is deleted at rollover.
- **Next tier, nothing changed.** Rows stay. A team that rolls its cycle early collects next-tier picks under the new name while the old ones stay scoped to their zones. Converts in #936 (a tier code from the team's open cycle; the form closes when there is none).

### `player_wcl_season_perf.season`

- **Writers.** The `fetchSeasonPerf` action of `wcl-sync` (`supabase/functions/wcl-sync/handler.ts`) upserts on `(player_id, season)` with the code the client sends: `fetchSeasonPerf()` (`js/tabs/tab-season.js`) sends `seasonCodeForDisplay()` of an archived entry's name from `seasonHistory`, so the stamp is always a past season of that team. Nothing deletes.
- **Readers.** `_checkSeasonPerfFetchedStatus()` (`js/tabs/tab-season.js`) counts the team's rows for that code. No SQL reader. The baseline reaches priority generation through `_seedScoringFromSeasonPerf()`, which writes `scoring` rows for the current season instead.
- **Format.** Code. **Meaning.** Cycle, as a tier code: an entry of the team's own history.
- **Next tier, nothing changed.** A fetch for the outgoing season lands under its code. Converts in #932 (foreign key, no value change).

### `priority_conflict_dismissals.season` and `priority_stale_dismissals.season`

- **Writers.** `dismissPriorityConflict()`, `restorePriorityConflict()`, `dismissAllPriorityConflicts()` and `restoreAllPriorityConflicts()` (`js/tabs/tab-priority.js`) insert and delete conflict rows; `dismissPriorityStale()`, `restorePriorityStale()` and the same two bulk functions handle stale rows. All stamp `resolveSeasonViewCode()`. `scripts/dev/db-snapshot.js` nulls `dismissed_by` on a local restore and leaves the season alone.
- **Readers.** `fetchSupabasePriorityConflictDismissals()` and `fetchSupabasePriorityStaleDismissals()` (`js/common.js`) load every season for the team, `remapPriorityDataForSeasonView()` keeps the current code's, and `_dismissedConflictKeys()` and `_dismissedStaleKeys()` (`js/tabs/tab-priority.js`) key them by season.
- **Format.** Code. **Meaning.** Cycle, as a tier code (Season View, else the team's season).
- **Next tier, nothing changed.** Dismissals under the old code stop matching, which is what a dismissal should do. Converts in #932.

### `priority_order.season`

- **Writers.** `save_priority_order(p_team_id, p_season, p_item_id, p_track, p_player_ids)` from `prioEditSave()` (`js/tabs/tab-priority.js`), with `resolveSeasonViewCode()`. `remove_player_priority_order(p_team_id, p_season, p_player_id)` from `executeRemovePlayer()` (`js/tabs/tab-roster.js`), same code. `add_signup_to_roster()` deletes the archived character's rows for the live season, converting the team's `seasonName` to a code in SQL. The #320 importer (`scripts/import/tables/priority.js`) took `--season` as a code.
- **Readers.** `fetchSupabasePriorityOrder()` (`js/common.js`) loads every season for the team and `remapPriorityDataForSeasonView()` keeps the rows for `resolveSeasonViewCode()`; `generate_priority_order(p_team_id, p_season, ...)` reads the current rows for `p_season`; `check_priority_order_drift(p_team_id, p_season)` behind `fetchSupabasePriorityDrift()` (`js/common.js`) and `refreshPriorityDriftBadge()` (`js/tabs/tab-priority.js`); `build_rclc_export(p_team_id, p_season, p_track)` behind `fetchExportString()` (`js/tabs/tab-priority.js`) and `qaExportString()` (`js/officer-quick-actions.js`), both with `seasonCodeForDisplay(DATA.seasonName)`; the six `priority_order_*` views (section 3); the app's `useItemRanks()` (`.eq('season', seasonCode)`).
- **Format.** Code. **Meaning.** Cycle, as a tier code.
- **Next tier, nothing changed.** The Priority tab reads the new code and shows an empty list until officers save; the old rows stay under `MID2`. Converts in #932.

### `priority_order_confirmed_empty.season`

- **Writers.** `save_priority_order()` inserts the marker when a list is saved with no players and deletes it when the same list is saved with players. Nothing else.
- **Readers.** `fetchSupabasePriorityOrderConfirmedEmpty()` (`js/common.js`), for the Priority tab's "confirmed empty" state.
- **Format.** Code. **Meaning.** Cycle, as a tier code. **Next tier, nothing changed.** As `priority_order`. Converts in #932.

### `raid_zones.season`

- **Writers.** `syncTeamZone()` in `wcl-progression-sync` (`supabase/functions/wcl-progression-sync/index.ts`) upserts one row per raid in the team's `raidProgression`, keyed `(wcl_zone_id, season)`, stamped with the team's `seasonName` or `Unknown` when the team has none. No other writer in the code; the catalog scripts tag items with a `wcl_zone_id` and do not write this table.
- **Readers.** `fetchSupabaseRaidZones()` (`js/common.js`) loads the table into `DATA.raidZones`, and `currentZoneIdsForSeason(resolveSeasonView())` inside `isItemInSeasonScope()` is the scope check behind the wishlist, the BiS list, the profile and the Priority tab. `populateSeasonViewOptions()` (`js/tabs/tab-season.js`) builds the Season View dropdown from the distinct values, so Season View can only name a season this table already holds. `reportsAllKnownSeasons()` (`js/tabs/tab-reports.js`). `fetchSupabaseRaidEncounters()` and `mapSupabaseRaidEncounters()` (`js/common.js`) copy the zone's season onto each encounter, read by `ownBonusRollSectionHTML()` (`js/bonusRoll.js`). `boeSeasonCatalogEntries()` (`js/boe.js`) scopes the found form's item picker to the zones of the selected team's season. `close_season()` folds it (with `raid_encounters` and `team_raid_progress`) into the history entry's raids; `archive_current_season()` joined it for the progress snapshot before #938. The app's `useRaidZones()` feeds `inSeasonZone()` (`app/src/profile/wishlist.ts`) and `inSeason()` (`app/src/profile/lootPriority.ts`).
- **Format.** Name. **Meaning.** Tier (a raid belongs to a tier), stamped from a team's cycle name, so the value is only ever as right as the syncing team's `seasonName`.
- **Next tier, nothing changed.** The first sync for a team whose `seasonName` is the new name creates the new tier's rows; a team with no name lands them under `Unknown`. Until a row exists, Season View cannot name the new tier and the scope check fails open (every raid item counts). Converted in #933 (2026-09-20): a raid not yet on file is stamped with `current_season()`, so the first sync after the tier's migration and an officer's edit of the raid list creates the new tier's rows for every team; the outgoing raid keeps its tier.

### `rclc_loot.season`

- **Writers.** `import_rclc_loot(p_team_id, p_season, p_rows)` from `submitLootImport()` (`js/tabs/tab-loot-import.js`) and `qaSubmitLoot()` (`js/officer-quick-actions.js`), both with `seasonCodeForDisplay(DATA.seasonName)`. The #320 importer (`scripts/import/tables/loot.js`) takes the season from the pasted row verbatim (checked against `seasons` by the guard at the top of the generated file since #938, not converted) or, for legacy rows, from `--seasons` date ranges, as the code since #938. `clearLootDataSupabase()` (`js/tabs/tab-admin.js`) deletes the team's rows; `submitLootReassign()` moves a row between players and keeps the stamp.
- **Readers.** `fetchSupabaseLoot()` and `mapSupabaseLoot()` (`js/common.js`) convert the code to a name for `DATA.lootCounts`, which `buildPublicStats()` and `buildRecentLoot()` (`js/roster.js`) and `getSeasonLootItems()` (`js/common.js`, against `ACTIVE_SEASON` from `populateSeasonSelector()` in `js/officer.js`) compare by name. `loadLootForReassign()` and `renderLootReassignRows()` (name through `seasonDisplayName()`) and `buildLootHistoryTab()` (`_lootHistorySeasonFilter`, a code) in `js/tabs/tab-loot-import.js`. `generate_priority_order()` (loot already received this season), `build_rclc_export()`, and the views `bis_demand_vs_awards`, `priority_order_live_first_prios`, `priority_order_stale_after_heroic` and `season_loot_pace`. The app's `useLoot()` reads every season.
- **Format.** Code. **Meaning.** Cycle, as a tier code (the team's name at import time).
- **Next tier, nothing changed.** Imports stamp the new code once Season Name changes; an import before that lands under the old code, which the Loot Import panel warns about. Converts in #932 (foreign key) and #938 (the import and archive paths).

### `scoring.season`

- **Writers.** `executeCommitScores()` (`js/tabs/tab-attendance.js`) and `executeCommitPerformance()` (`js/tabs/tab-scoring.js`) upsert on `(player_id, season)` with `seasonCodeForDisplay(DATA.seasonName)`. `_seedScoringFromSeasonPerf()` (`js/tabs/tab-season.js`) seeds the current code from a previous-season fetch, without overwriting. The #320 importer (`scripts/import/tables/scoring.js`) took `--season` as a code.
- **Readers.** `generate_priority_order()` (`sc.season = p_season`) and `_fetchTeamScoringIfNeeded()` (`js/tabs/tab-roster.js`, `.eq('season', seasonCode)`).
- **Format.** Code. **Meaning.** Cycle, as a tier code.
- **Next tier, nothing changed.** Commits land under the new code; the generator finds no scores under it until the first commit. Converts in #932.

### `season_signups.season`

- **Writers.** `submit_season_signup()` stamps the team's `activeSignupSeason`, null when the key is absent (the one null row). `update_own_signup()` refuses an edit unless the row's season equals the active signup season. `add_signup_to_roster()`, `reviewSignup()` (`js/tabs/tab-signups.js`) and `removePendingRosterRow()` (`js/tabs/tab-pending-roster.js`) change status only. `danger_clear_season_signups()` and `danger_clear_pending_roster()` delete rows.
- **Readers.** `get_own_signup()` and the `incoming_roster` view compare it with `activeSignupSeason`; `pending_roster` exposes it. `fetchSignups()` selects it and `renderSignupHistory()` (`js/tabs/tab-signups.js`) groups by it against `DATA.signupSeason`; `fetchMissingSignups()` (`js/tabs/tab-pending-roster.js`) compares it with the same. The app's `useIncomingRoster()` reads through `incoming_roster`.
- **Format.** Name: whatever `activeSignupSeason` holds, which is free text.
- **Meaning.** Cycle, the team's next one.
- **Next tier, nothing changed.** Signups keep stamping the old name until an officer changes Signup Season; the roster page's incoming tab keys on the same value. Converts in #934.
- **Converted in #934 (2026-09-21).** The code, referencing `seasons(code)`; the named rows converted through `seasons` and the one null row took the tier current on its submit date (`MID1`). The stamp is the tier the raider picked (`p_season`), which `submit_season_signup()` accepts only when the team's `team_seasons` row for it has `signups_open`; `get_own_signup()` takes the tier too; `update_own_signup()` keeps an added row editable while that switch is on; `incoming_roster` joins the row, open or closed. The site and the app read the column through `seasonDisplayName()` / `seasonName()`. The column stays nullable, as `boe_items.season` did.

### `tier_token_map.season`

- **Writers.** The seed SQL from `scripts/generate-tier-token-map-sql.js` (its `SEASON` constant). `20260914113413_tier_token_map_season.sql` added the column and backfilled `MID2`. No runtime writer.
- **Readers.** `generate_priority_order()` matches `ttm.season = p_season` in both of its lookups and checks that the season being generated has rows at all. `fetchSupabaseTierTokenMap()` (`js/common.js`) loads every season for display; `tierSeasonCode()` picks one for the tier-piece counter behind `syncRosterTierCounts()` and `buildPriorityTierSetupBannerHtml()` (`js/tabs/tab-priority.js`). The app's `useTierTokens()` and `useSeasonTierTokens()` filter on the season code.
- **Format.** Code. **Meaning.** Tier: a guild-wide seed.
- **Next tier, nothing changed.** No rows under the new code until the seed is regenerated with the new token names; the Priority tab says so and Sync Roster Tier Counts refuses to run (#1108). Converts in #932 (foreign key).

### `track_bonus_ids.season`

- **Writers.** `20260913013949_track_bonus_ids_and_equipped_bonus_list.sql` seeded the rows. No runtime writer.
- **Readers.** `loadBonusTrackMap()` in `blizzard-gear-sync` reads `bonus_id, track` and ignores the season on purpose: Blizzard issues a fresh id block each tier, so rows cannot collide across seasons.
- **Format.** Code. **Meaning.** Tier, provenance only.
- **Next tier, nothing changed.** The new tier's block is appended under its own code; nothing reads the old one. Converts in #932 (foreign key).

## 3. View columns (10)

Every view is `security_invoker`; a view column is whatever base column it projects, so the format and meaning are the base column's.

| View column | Derived from | Filtered by a season? | Readers |
| --- | --- | --- | --- |
| `bis_demand_vs_awards.season` | `rclc_loot.season` (the awards leg; demand from `item_preferences` is not season-filtered, so an item appears once per award season) | no | `loadBisDemandReport()` (`js/tabs/tab-reports.js`) |
| `pending_roster.season` | `season_signups.season` | no | `tryRender()` (`js/tabs/tab-pending-roster.js`); `fetchSupabaseSignupCounts()` (`js/officer.js`) counts rows only |
| `priority_order_first_prio_counts.season` | `priority_order.season`, grouped | no | none on the site: `fetchSupabasePriorityLiveFirstPrios()` explains that the client counts from the live-first-prio rows instead |
| `priority_order_gaps.season` | `priority_order.season` (distinct team and season pairs, crossed with the roster) | no | `loadPriorityHealthReport()` (`js/tabs/tab-reports.js`) |
| `priority_order_live_first_prios.season` | `priority_order.season`, joined to `rclc_loot` on the same season | no | `fetchSupabasePriorityLiveFirstPrios()` (`js/common.js`, every season, filtered by `remapPriorityDataForSeasonView()`); `prioEditFetchFairnessWarnings()` (`js/tabs/tab-priority.js`, `.eq('season', season)`); the `priority_order_same_boss_conflicts` view |
| `priority_order_same_boss_conflicts.season` | `priority_order_live_first_prios.season` | no | none on the site |
| `priority_order_stale_after_heroic.season` | `priority_order.season`, with `rclc_loot` Hero awards on the same season | no | `fetchSupabasePriorityStaleAfterHeroic()` (`js/common.js`); `loadPriorityHealthReport()` |
| `priority_order_stale_entries.season` | `priority_order.season` | no | `loadPriorityHealthReport()` |
| `season_loot_pace.season` | `rclc_loot.season` | no | `loadLootPaceReport()` (`js/tabs/tab-reports.js`) |
| `season_loot_pace.season_week` | weeks since the team's first award under that `rclc_loot.season` | no | `loadLootPaceReport()` |

`incoming_roster` carries no season column but reads one: since #934 it keeps `season_signups` rows whose `season` is a tier the team has a `team_seasons` row for, open or closed (before that, rows whose `season` equalled the team's `activeSignupSeason`).

## 4. `team_settings.config` keys (22)

`config` is jsonb with no default, so an absent key and an unset key are the same thing and every reader supplies its own fallback. The code names 22 keys; production holds 20 of them across teams (team 1 all 20, team 2 16, team 3 three, team 4 none). `discordSignupChannelId` and `signupSheetLeadHours` are named by the code and set on no team.

Writes go through `saveTeamSetting()` (`js/common.js`), which calls the `set_team_setting` RPC to merge the keys it is given; two SQL functions write keys of their own (`close_season()`, which appends to `seasonHistory`, and `set_team_officer_bios()`), and the dashboard's SQL Editor is a known writer that leaves no trace. Reads on the current site go through `applyTeamSettingsToData()` (`js/common.js`), which copies `SEASON_CONFIG_KEYS` onto `DATA` under the same names; the new app, the bot and the Edge Functions read the column directly. Which of the cycle keys a `team_seasons` row replaces is #939's to decide; "converts in" below names #939 for every key that describes the cycle.

| Key | Type | Teams holding it | Tier, cycle or neither | Converts in |
| --- | --- | --- | --- | --- |
| `seasonName` | gone since #938 (`20260921201717_retire_season_name.sql`); was a string, a name | none | cycle | #938 |
| `seasonStart` | gone since #1269 (`20260922123711_retire_season_dates.sql`); was a string, `YYYY-MM-DD` | none | cycle | #1269 |
| `seasonEnd` | gone since #1269 (same migration); was a string, `YYYY-MM-DD` | none | cycle | #1269 |
| `seasonHistory` | array of archived cycles | 1, 2 | cycle | #939 |
| `seasonView` | string (a `raid_zones.season` name) or null | 1, 2 (null) | cycle (a planning override) | #933 |
| `activeSignupSeason` | string, free text (a name today) | 1, 2 | cycle (the next one) | #934 (shipped 2026-09-21: the key is gone; the signup seasons are the `team_seasons` rows with `signups_open`) |
| `raidProgression` | array of raids with bosses | 1, 2 | cycle (the team's raid list for its season) | #939 |
| `trackIlvlThresholds` | object, `{Hero, Myth}` floors | 1, 2 | tier in meaning, per team in storage | none filed |
| `signupsOpen` | boolean | 1, 2, 3 | neither (a gate) | #939 (shipped 2026-09-21: a `team_seasons` row per tier; #934 stripped the key the same day) |
| `bisSubmissionsOpen` | boolean | 1, 2 | neither (a gate) | none |
| `mPlusExclusionsOpen` | boolean | 1, 2 | neither (a gate) | none |
| `wishlistOpen` | boolean | 1, 2 | neither today | #939 (shipped 2026-09-21: a `team_seasons` row per tier; #934 stripped the key the same day); #936 closes the insert path on it |
| `trialWeeks`, `trialAttend` | numbers | 1, 2 | neither | none |
| `targetTankCount`, `targetHealCount` | numbers | 1 | neither | none |
| `features` | object of flags | 1, 2, 3 | neither | none |
| `wishlistStatusLabels` | object | 1 | neither | none |
| `externalLinks` | object, `{warcraftLogsUrl}` | 1, 2, 3 | neither | none |
| `teamOfficerBios` | array | 1 | neither | none |
| `discordSignupChannelId` | string or null | none | neither | none |
| `signupSheetLeadHours` | number or null | none | neither | none |

### `seasonName`

Retired by #938's fourth pull request (`20260921201717_retire_season_name.sql`, 2026-09-21): the key left every config row, and every reader below takes the tier from the `seasons` table instead (`currentSeasonCode()` and `currentSeasonName()` in `js/common.js`; `currentSeason()` in `app/src/profile/profile.ts`). The rest of this section is the state before.

- **Writers.** `saveSeasonName()` (`js/tabs/tab-season.js`) builds `Midnight Season N` from the number typed, through `_seasonDisplayPrefix()`. Until #938's third pull request (`20260921194720_close_season.sql`) `executeArchiveSeason()` (the Start New Season button) called `archive_current_season()`, which blanked the key after appending the cycle to `seasonHistory`, then wrote `CURRENT_SEASON.displayName` with `seasonView: null`, and `executeUnarchiveSeason()` called `unarchive_season()`, which restored it from a history entry; `close_season()` leaves the key alone. Teams 3 and 4 have never had it set.
- **Readers, SQL.** None since #938's third pull request; `archive_current_season()` refused when it was blank and snapshotted it. Since #938's first pull request (`20260921192826_cleanups_read_current_season.sql`) `add_signup_to_roster()` and `review_main_swap_request()` clear the archived character's `priority_order` rows for `current_season()` in place of the regex read of this key, which had skipped the cleanup on every team with no name (teams 3 and 4). `submit_boe_found()` stamps `current_season()` since #937.
- **Readers, functions.** `wcl-progression-sync` (the `raid_zones` stamp, `Unknown` when blank).
- **Readers, site (before #938).** `resolveSeasonView()` and `resolveSeasonViewCode()` (`js/common.js`), behind every scope check and every Priority write. `seasonCodeForDisplay(DATA.seasonName)` directly in `fetchExportString()`, `qaExportString()`, `qaSubmitLoot()`, `submitLootImport()`, `buildLootHistoryTab()`, `executeCommitScores()`, `executeCommitPerformance()`, `_seedScoringFromSeasonPerf()`, `reportsCurrentSeasonCode()` and `_fetchTeamScoringIfNeeded()`. By name in `populateSeasonSelector()` (`js/officer.js`), `buildPublicStats()`, `buildRecentLoot()` and `bootRosterApp()` (`js/roster.js`, which sets `ACTIVE_SEASON`), `signupClassmatesPool()` (`js/signup.js`), `getSeasonDateRange()`, `buildLootImportForm()`, `buildSeasonTab()`, `loadAdminProperties()`, and `refreshBoeTeamOptions()` (`js/boe.js`, every team's, for the found form).
- **Readers, app (before #938).** `useCurrentSeason()` (`app/src/profile/useProfile.ts`), which derived the code with `seasonCode()`; the wishlist editor and loot priority card scope by it. Since #938 it reads the `seasons` table and keeps the team's typed dates until #1269.
- **Bot.** `bot/src/index.ts` declares `seasonName` on the payload it fetched from the retired Apps Script roster endpoint (#225); it does not read this key.
- **Meaning.** Cycle. **Next tier, nothing changed.** Each team types the number (Start New Season wrote it until #938's third pull request; Close Season does not); until then every stamp above carries the old name, and a team that never does keeps stamping it forever. The key retires in #938's fourth pull request.

### `seasonStart`, `seasonEnd`

- **Writers.** None. `saveSeasonStart()` and `saveSeasonEnd()` (`js/tabs/tab-season.js`) wrote them from the Season Start Date and Season End Date cards until #1269's third pull request, which took the cards, the saves and the keys (`20260922123711_retire_season_dates.sql`); until #938's third pull request `archive_current_season()` blanked both and `unarchive_season()` restored them.
- **Readers.** None. `seasonHasStarted()` and `joinedAfterSeasonStart()` (`js/common.js`) read the start and `getSeasonDateRange()` read both for the active season's window; `buildSeasonTab()` and `loadAdminProperties()` displayed them; `refreshAttendance` in `wcl-sync` (`supabase/functions/wcl-sync/handler.ts`) fetched reports from the start date; the app's `useCurrentSeason()` read both.
- **What answers it now.** `team_season_start(p_team_id, p_season)` (`20260922000521`), the earliest night the sync filed from a report for that team inside the tier, else the tier's `starts_at`; the end is the tier's `ends_at`. The site loads the night once per page (`fetchSupabaseSeasonStart()`, into `DATA.seasonStartDate`) and `seasonDateRangeFor()` is the one place that assembles the window; the app's `useCurrentSeason()` calls the same function; the sync fetches from the tier's `starts_at` through `current_season()`.
- **Meaning.** Cycle, retired. **Next tier, nothing changed:** every team's window moves with the tier, and a team that starts the tier late counts from its own first night with no setting to edit.

### `seasonHistory`

- **Writers.** `close_season(p_team_id, p_season, p_roster_snapshot)` (#938, `20260921194720_close_season.sql`) appends an entry (`code`, `name`, the team's first raid night in the tier as its `start` from `team_season_start()` (#1269) and the tier's `ends_at` as its `end`, `raids` folded from `raid_zones`, `raid_encounters` and the team's `team_raid_progress` rows, and the roster snapshot the site builds over that tier's window) for a tier that has ended and the team has not closed; the two entries written before it (both Midnight Season 1) gained `code` in the same migration. Before that, `archive_current_season()` appended the team's cycle (`name`, `start`, `end`, `raids` from `raidProgression`, the roster snapshot) and blanked the active keys.
- **Readers.** `renderSeasonHistory()` and `fetchSeasonPerf()` (`js/tabs/tab-season.js`, by `historyEntryCode()`: the entry's `code`, else the pattern read of its `name`), `closableSeasonCodes()` (the tiers already closed); `buildSeasonRecap()` and `updateHistoryNavItem()` (`js/roster.js`); `populateSeasonSelector()` (`js/officer.js`); `getSeasonDateRange()`; `loadAdminProperties()`.
- **Meaning.** Cycle: the team's past cycles, one array entry each. **Next tier, nothing changed.** One more entry per team that archives; #939 replaces the array with rows.

### `seasonView`

- **Writers.** `saveSeasonView()` (`js/tabs/tab-season.js`), from a dropdown `populateSeasonViewOptions()` fills with the distinct `raid_zones.season` values; `executeArchiveSeason()` set it to null when starting a new season, until #938's third pull request; `executeCloseSeason()` leaves it alone.
- **Readers.** `resolveSeasonView()`, `resolveSeasonViewCode()` and `isItemInSeasonScope()` (`js/common.js`); `refreshBoeTeamOptions()` (`js/boe.js`); `buildSeasonTab()`; the app's `useWishlistSettings()`. No SQL reader.
- **Format.** A `raid_zones.season` value, so a name today; `resolveSeasonViewCode()` returns it where a code is expected (#923).
- **Meaning.** Cycle: an officer's planning override for the catalog, wishlist, BiS and priority scope, separate from `activeSignupSeason` on purpose. **Next tier, nothing changed.** Cannot name the new tier until `raid_zones` holds a row for it. Converted in #933 (2026-09-20): a code, stored by the dropdown and read as one everywhere.

### `activeSignupSeason`

- **Writers.** `saveSignupSeason()` (`js/tabs/tab-season.js`), from the number typed.
- **Readers.** `submit_season_signup()` (the stamp), `update_own_signup()`, `get_own_signup()`, the `incoming_roster` view; on the site as `DATA.signupSeason` in `showRosterSubTab()` (`js/roster.js`, the incoming tab's label), `signupClassmatesPool()` (`js/signup.js`), `fetchMissingSignups()`, `renderSignupHistory()` and `buildSeasonTab()`; the app's `useSignupSeason()` (`app/src/roster/useRoster.ts`).
- **Meaning.** Cycle, the next one: signups for a tier open while the current tier is still raided. **Next tier, nothing changed.** Signups keep the old name until an officer changes it. Converts in #934.
- **Retired in #934 (2026-09-21).** The key is gone from every config row: a team's signup seasons are its `team_seasons` rows with `signups_open`, the officer picks the tier beside the Signups toggle (`renderSignupToggle()`, from the `seasons` rows that have not ended), the raider's form picks one of the open tiers (`signupTier()` in `js/signup.js`, a select only when more than one is open), and every reader above reads `openSignupSeasonCodes()` (`js/common.js`) or the app's `useSignupSeasons()`.

### `raidProgression`

- **Writers.** `saveRaidProgression()` (`js/tabs/tab-season.js`, after Refresh from WCL builds the list). Until #938's third pull request `archive_current_season()` emptied it after folding each boss's progress into the history entry and `unarchive_season()` restored it; `close_season()` folds the tier's raids from `raid_zones`, `raid_encounters` and `team_raid_progress` instead and leaves this list alone.
- **Readers.** `wcl-progression-sync` (which raids to sync, and the `raid_zones` rows it upserts); `refreshAttendance` in `wcl-sync` (the zone ids that count); `buildProgression()` (`js/roster.js`); `populateBossFilters()` (`js/tabs/tab-priority.js`); `buildSeasonTab()`; `loadAdminProperties()`.
- **Meaning.** Cycle: the raids the team runs this season. **Next tier, nothing changed.** Officers rebuild the list for the new tier whenever they get to it, before or after closing the old one; a sync before that writes nothing new.

### `trackIlvlThresholds`

- **Writers.** `saveAdminTrackThresholds()` (`js/tabs/tab-admin.js`).
- **Readers.** `syncRoster()` in `blizzard-gear-sync` (the sweep reads every team's, the single-team run reads one) to grade equipped items into tracks; `renderAdminTrackThresholds()`.
- **Meaning.** Tier in meaning (the floors belong to the tier) and per team in storage. **Next tier, nothing changed.** Re-entered by hand on each team, like the token seed.

### `signupsOpen`, `bisSubmissionsOpen`, `mPlusExclusionsOpen`, `wishlistOpen`

- **Writers.** `setSignupsOpen()` (`js/tabs/tab-signups.js`), `setBisSubmissionsOpen()` and `setWishlistOpen()` (`js/tabs/tab-bis.js`), `toggleMPlusOpen()` (`js/tabs/tab-mplus.js`).
- **Readers.** `submit_season_signup()` refuses when `signupsOpen` is false; `submit_bis_link()` on `bisSubmissionsOpen`; `submit_mplus_exclusion()` on `mPlusExclusionsOpen`. On the site: `updateSignupNavItem()` (`js/roster.js`), `fetchGuildTeamSettings()` and `renderGuildTeams()` (`js/guild.js`, every team's `signupsOpen`), `renderSignupToggle()`, `bisSubmissionsOpen()`, `wishlistOpen()` and `renderProfile()` (`js/common.js`), `loadAdminProperties()`. The app's `useWishlistSettings()` reads `wishlistOpen`. `wishlistOpen` has no SQL reader: the `Raiders manage own item_preferences` policy (`my_active_player_ids()`) admits an insert whether or not the key is set, so the gate is client-side only.
- **Meaning.** Neither: gates. **Next tier, nothing changed.** Nothing; #936 closes the wishlist insert path when the team has no open cycle.
- **Since #939 (2026-09-21).** `signupsOpen` and `wishlistOpen` are rows on `team_seasons`, one per team and tier, written only by `set_team_season()`; the Signups toggle controls the tier picked beside it (since #934; the tier `activeSignupSeason` named, for the hours between the two) and the Wishlist Editing toggle the tier `resolveSeasonViewCode()` returns, and every reader above reads the row instead of the key. No row means closed. #934 removed the two keys from `config` the same day. `bisSubmissionsOpen` and `mPlusExclusionsOpen` are unchanged.
- **Since #936 (2026-09-24, `20260924033647_wishlist_write_gate.sql`).** The wishlist switch is enforced at the database as well as on the page: the `restrict_item_preferences_to_open_wishlist()` trigger refuses a raider's insert, update or delete of their own `item_preferences` row unless the team's `team_seasons` row for the row's own season has `wishlist_open`, or the character has `players.wishlist_allowed`. A row with no season opens only for that override.

### `trialWeeks`, `trialAttend`, `targetTankCount`, `targetHealCount`

- **Writers.** `saveTrialThresholds()`, `saveRosterTargets()` (`js/tabs/tab-season.js`).
- **Readers.** `buildTrialPromoAlert()` (`js/tabs/tab-roster.js`) for the two trial thresholds; `buildSignupRoleAdvisoryHtml()` (`js/signup.js`) for the two targets; `buildSeasonTab()`. The bot's payload interface declares the trial keys from the retired Apps Script endpoint, as with `seasonName`.
- **Meaning.** Neither. **Next tier, nothing changed.** Nothing.

### `features`, `wishlistStatusLabels`, `externalLinks`, `teamOfficerBios`

- **Writers.** `toggleAdminFeatureFlag()` (`js/tabs/tab-admin.js`) and `toggleFeatureFlag()` (`js/admin.js`, through `set_team_setting` directly) for `features`; `saveAdminWishlistLabels()` (`js/tabs/tab-admin.js`); `saveWclUrl()` (`js/tabs/tab-season.js`); `set_team_officer_bios()` from `saveBios()` (`js/tabs/tab-bios.js`).
- **Readers.** `featureEnabled()` (`js/common.js`), `applyFeatureFlagVisibility()` (`js/officer.js`), `refreshBoeTeamOptions()` (`js/boe.js`) and `fetchGuildTeamSettings()` (`js/guild.js`) for `features`; `build_rclc_export()`, `officerWishlistSectionHTML()` (`js/common.js`), `wishlistStatusButtonsHTML()` (`js/wishlist.js`), `buildPriorityNotesTab()`, `buildPriorityTab()` and `prioEditWishlistBadgeHtml()` (`js/tabs/tab-priority.js`) for `wishlistStatusLabels`; `renderExternalWclLink()` (`js/common.js`), `fetchGuildTeamSettings()` and `buildSeasonTab()` for `externalLinks`; `showAboutSubTab()` and `buildBios()` (`js/roster.js`) for `teamOfficerBios`.
- **Meaning.** Neither. **Next tier, nothing changed.** Nothing.

### `discordSignupChannelId`, `signupSheetLeadHours`

- **Writers.** `saveDiscordSignupSheetSettings()` (`js/tabs/tab-season.js`). Set on no team.
- **Readers.** `runSignupSheetSweep()` (`bot/src/signupSheet.ts`) reads `signupSheetLeadHours` with a default; its comment records that the channel id read moved to `team_discord_config`. `buildSeasonTab()` displays both.
- **Meaning.** Neither. **Next tier, nothing changed.** Nothing.

## 5. The next tier with nothing changed

Derived from the entries above, in the order the tier would hit them.

1. `CURRENT_SEASON` in `js/common.js`, `SEASON` in `scripts/generate-tier-token-map-sql.js` and the two copies of the prefixes are edited by hand, and the token seed is regenerated; until it is, Sync Roster Tier Counts refuses (#1108). #932 makes the tier a row; #939 gives every team a default.
2. Each team typed the next name (Start New Season wrote it until #938's third pull request, on 2026-09-21); a team that does not keeps stamping the old name into `boe_items`, `item_preferences` and `raid_zones`, and its priority, loot and scoring writes stay under the old code. #938 moves that flow to codes; #939 replaces the keys with `team_seasons` rows.
3. `raid_zones` has no row for the new tier until a team with the new `seasonName` runs `wcl-progression-sync`; a team without one lands the rows under `Unknown`. Until the row exists Season View cannot select the tier and the scope check fails open. #933.
4. Teams 3 and 4 have no cycle: their BoE finds stamp null (five rows today), and a signup submitted while `activeSignupSeason` is absent stamps null (one row today). #937 borrows the guild's tier for finds (shipped); #934 stamps the tier the raider picked from the ones the team opened (shipped); #936 scopes the wishlist.
5. `activeSignupSeason` and `seasonView` are free text and a raid-zone name; both keep working only while an officer types the same name the code derives. #934 retired the first (the tier is picked from `seasons`); #933 converted the second.
6. `boe_items.season` is written and never read, so nothing surfaces a wrong or missing stamp until #937 gives it a reader.
7. The wishlist rows follow each team's rollover by name; #936 stamps the tier code of the team's open cycle and closes the form when there is none.
8. `trackIlvlThresholds` is re-entered per team by hand. No issue files it; it is the one key whose meaning is the tier and whose storage is the cycle.
