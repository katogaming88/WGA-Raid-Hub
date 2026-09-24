# Database Decisions Log

A running record of settled database/schema decisions and the reasoning behind them. Each entry links back to the GitHub issue comment with the full discussion -- this log is a summary and index, not a replacement for that context.

Issues carrying a decision are tagged with the `decision` label: `gh issue list --label decision --state all`.

An entry that changed the schema carries a line beginning `Shipped:` under its heading, naming the migration file that carried it (`YYYYMMDDHHMMSS_slug.sql`; more than one, separated by commas). An entry whose change has not shipped opens that line with `not yet` and names the issue that will ship it; one that shipped no migration opens with `no migration` (a convention, a doc, CI, app code) or `by hand` (applied outside a migration, naming the issue that records it). `scripts/ci/decision-log-check.js` fails a pull request whose line names a file that is not under `supabase/migrations/`, a misspelling and a rename included (#943). It proves the name, not the object: whether the object an entry describes is live is still the build's own query, because #250 below recorded four changes in the voice of fact and two of them never shipped.

Each heading's date is the real calendar date the decision was made. It is deliberately **not** taken from the accompanying migration's filename: those timestamps only have to increase monotonically, and have drifted well ahead of real time (the migration written on 2026-07-11 is named `20260726...`). Entries from 2026-07-12 through 2026-07-18 were dated that way by mistake and have been corrected to when they were actually committed. Since #927 new files are stamped by `npm run migration:new`, from the Eastern wall clock, and CI fails one that runs ahead of it, so the drift stops here rather than being corrected after the fact.

---

## 2026-09-24 -- a wishlist pick is one per item, slot and season (#936)

Shipped: 20260924145125_wishlist_season_key.sql

`item_preferences_no_dupe_item_key` has been `(player_id, item_id, coalesce(slot, ''))` since #515 Phase 1, when there was one tier of picks and no season column. The column exists now, holds a code, and the write gate reads the season on the row, so the row's season already says which tier a pick belongs to everywhere except the key. The third of #936's parts gives it to the key, and both editors stop reading across tiers.

- **The key only widens, so it cannot fail on existing data.** Every pair it used to separate it still separates, and no row has to be touched. A missing season reads as one value (`coalesce(season, '')`), so the two rows a raider could not tell apart, same item and slot with neither stamped, stay a duplicate. The column stays nullable; making it `not null` and the 9 rows with no season belong to #945.
- **Both editors read and write one tier, which they did not have to before.** While a pick was unique by item and slot, finding one in whichever season it landed in gave the same answer as asking about the tier being planned. Once a raider can hold the same item in two tiers those part, and the untiered lookup is the worse one: it hands back a row the write gate refuses, part-way through a re-tag that has already deleted rows. On the current site every query for a raider's own picks now names a tier through one helper (`wishlistScopeToSeason()`), and the insert stamps through the same one, so the tier the gate reads, the tier stamped and the tier queried cannot drift apart. In the app the filter is on the three functions that already take the season: the editor's slots, its write plan and the Loot priority card's count.
- **Clear All is scoped to the tier the page is showing.** It carries no item or slot filter by design, so unscoped it removed picks the page was not showing, and the write gate refuses a statement reaching a closed tier's rows, which would have left a raider holding a past tier of picks pressing a button that did nothing. Its confirm wording still says the whole wishlist and is unchanged here, being raider-facing copy.
- **The tripwire is gone.** `tests/rls/item-preferences.test.js` failed if a tier started after MID2 while the key had no season. That order is kept now, and the cases that replace it assert the key carries the season and that a raider can file the same item and slot in two tiers.
- **Not moved with this.** The rest of what decision 13 on #1189 gave #936: `generate_priority_order()` filtering picks by season, and a raider's season switcher replacing the Season View pin as the stamp. The demand report and the setup status still count picks from every season (#1268). Nothing reads the column through a filter in SQL yet, so no reader's results move.

[Full discussion -> #936](https://github.com/katogaming88/WGA-Raid-Hub/issues/936).

## 2026-09-24 -- item_preferences.season holds the code, and the database holds the wishlist switch (#936)

Shipped: 20260924003956_wishlist_season_codes.sql, 20260924033647_wishlist_write_gate.sql

The last of the five name columns #932 left keyed to `seasons(display_name)`. The other four converted or went between #933 and #935; this one waited because the wishlist was to follow a team's own cycle, and decision 13 on #1189 (2026-09-20) ended that. It shipped in two parts, the conversion and then the write gate.

- **The foreign key is the conversion, not a backfill beside one.** The rows convert and the key moves to `seasons(code)` in the same migration, so a display name has nowhere to land afterwards: no later writer can reintroduce the format and no row can sit between the two. `seasons(display_name)` is unique and `code` is the primary key, so the mapping is total and unambiguous and the key addition would fail loudly on any row the update missed. Proved against data as well as the constraint, since the local stack holds no wishlist rows: a rollback-only transaction rebuilt the old shape with three named rows and one null, replayed the migration and left three codes, the null untouched and nothing holding a name.
- **Null rows stay null.** They predate the column, and `isItemInSeasonScope()` fails open on them on purpose so a row tagged before the column existed is shown rather than disappearing.
- **Both writers stamp the code they already had.** Each resolved a code to scope the raid catalog by zone and then converted it to a name for this column alone: `resolveSeasonView()` on the current site, the `name` half of `editorSeason()` in the app. Both conversions are gone, and the gate and the stamp are now literally the same value rather than two forms of it.
- **An unresolved tier stamps null, not the empty string.** That is what the code resolver returns when no tier resolves at all, and it is not a `seasons` row, so writing it failed the foreign key with an error a raider could not act on. Reachable through `players.wishlist_allowed`, which opens editing for one raider without a `team_seasons` row to resolve against.
- **`build_rclc_export()` is reissued for its comment, with no behaviour change.** Its wish CTE said it skipped a season filter because the column held a name while `p_season` is a code, and that sentence would have shipped false. The filter stays off for the reason that survives, which is that `generate_priority_order()` does not filter by season either, so `item_id` plus `team_id` is the scope the export has to match. Whether it should filter now that the formats agree is a behaviour question and belongs on its own issue.
- **The database holds the wishlist switch, not only the page.** A trigger, `restrict_item_preferences_to_open_wishlist()`, refuses a raider's insert, update or delete of their own row unless the team's `team_seasons` row for the season stamped on the row has `wishlist_open`, or the character has `players.wishlist_allowed`. An update is checked on both sides, so a row can neither be edited in a closed season nor moved into one. A row with no season has no switch and opens only for the override.
- **The page and the gate ask about different seasons, and agree on today's data.** The page asks about the season it plans for (the Season View pin, else the current tier) and stamps that season on a new pick, but it finds an existing pick by item and slot in any season, because `item_preferences_no_dupe_item_key` has no season in it. The gate asks about the season on the row. Read on production before this shipped (2026-09-24): no team has a pin, Hellfire Rollers has MID2 open, Phoenix has it closed with seven raiders on the override, Immolation has no row, and of the 2,580 rows active raiders hold, none is one the page would let its owner edit and the gate would refuse. The 9 rows with no season belong to 2 archived characters, who cannot write at all. The two part once a raider holds picks in two seasons: re-tagging an M+ or crafted pick, the site's BiS demote and the app's delete-then-update would all reach a closed season's row, and the demote and the app's plan go out as separate requests, so a refusal part-way would leave a slot with two BiS picks or lose picks already deleted. That needs a tier after MID2, so a tripwire in `tests/rls/item-preferences.test.js` fails when one lands while the key has no season, and #936's season-keyed key goes first.
- **A trigger, not a narrower raiders' policy.** A policy refusal on an update or a delete filters the row out and reports success with nothing changed, so a page open since before an officer closed editing would have shown a removal that never happened; the trigger raises, and both pages print the error they are given. And the officers' note-clearing policy is permissive: OR'd with a narrowed raider policy it would still admit an officer's update to their own character's rows, because the note-only trigger steps aside for a row that is the caller's own. The trigger holds only the caller's own rows, so an officer clearing someone else's note, and anything not running as `authenticated`, pass as before.
- **Not moved with this.** The rest of what decision 13 on #1189 gave #936: the unique key gaining the season, `generate_priority_order()` filtering by it, and a raider's season switcher replacing the Season View pin as the stamp. The site's Clear All deletes every row a raider holds, so once a raider has rows in a season that has closed it is refused as a whole; that needs a second tier of picks, so it arrives with the switcher. The demand report and the setup status still count picks from every season (#1268). Making the column `not null` and the 9 null rows belong to #945.

[Full discussion -> #936](https://github.com/katogaming88/WGA-Raid-Hub/issues/936).

## 2026-09-23 -- Guild and team names are labels: guilds may share a name, a team's name is unique within its guild (#1226)

Shipped: 20260923220757_names_unique_per_guild.sql

Kat's call while reviewing guild creation (2026-09-23): a guild is identified by its random code and a team by its own, so the name is only what people read. Two rules treated it as an identity anyway, `guilds_name_key` (no two guilds share a name) and `teams_name_key` (no two teams share a name anywhere on the site), so a second guild could not have a team called "Phoenix". Supersedes the 2026-09-13 note that `teams.name` stays site-wide until a second guild exists.

- **Both rules are gone; one narrower rule replaces the second.** `teams_guild_id_lower_name_key` makes a team's name unique within its own guild, ignoring case: one guild cannot have two teams called Phoenix, but "WGA Team 1" and "WGA Team 2" are different names, and another guild may reuse either. Guild names may repeat outright (guild names are unique per realm in the game, not across the site).
- **Nothing keyed on the name.** Every lookup uses the id, `url_key` or `slug`; the four teams on production have no repeated name within a guild (checked read-only 2026-09-23), so the index applies cleanly.
- `create_guild()` no longer checks names: a new guild has no other team to clash with. `admin_create_team()` and `admin_update_team()` now get the per-guild error from the index.
- Still open before creation is opened to everyone (#1324): guild officers act in every guild, grants refuse a second guild, and one person can create unlimited guilds.

## 2026-09-23 -- Creating a guild and its first team, behind a switch a site admin flips (#1226)

Shipped: 20260923220749_guild_creation.sql

The site front page (#1226) gets a create-your-guild form. Kat decided (2026-09-23) not to open guild creation yet, but to build it now so opening it later is one switch, not another release.

- **`site_settings.guild_creation_open`, default false.** While false nobody can create a guild, a site admin included (Rex's review of #1323, Kat agreed 2026-09-24): a site admin who means to create one turns the switch on, creates it, and turns it back off. A guild created by accident cannot be undone from the app, and the first one turns off four Site Admin buttons (below). Once true, anyone signed in with Discord can. `admin_set_guild_creation_open()` (site admin only, audit-logged) is the only write path; `guild_creation_open()` reads it and is granted to `anon`, because the signed-out front page decides whether to offer the form before sign-in.
- **`create_guild(name, region, realm, team_name)`** makes the guild, its first team, the `team_settings` row and the caller's `team_leader` membership in one step, and answers with the two address keys. Both keys are the random defaults; a readable key stays a site admin's to give (#1114). The team name is optional (Kat, 2026-09-23: a guild with one team does not name it): left blank, the team takes the guild's name. It refuses a missing Discord (the leader's membership is keyed on it, as in `team_invite_link_join()`), a blank or over-long guild name, an over-long team name, a region outside us/eu/kr/tw, a blank realm (names may repeat, see the next entry). It writes its own `audit_log` row, as the other self-service RPCs do.
- **The switch must stay off until #1324 lands.** A second guild is still unsupported: `only_guild_id()` (used by `admin_grant()`) raises once a second guild exists, and `admin_create_team()` refuses to guess, so Grant Site Admin, Grant Guild Officer, Grant BoE Manager and Add Team all stop working, for We Go Again too (measured in Rex's review of #1323). The switch is the place to hold that line; the site admin's card on the create page says so.
- **Not limited yet:** nothing stops one person creating many guilds once the switch is open. Limits belong to the team plan work (#1259), and the switch is off until then.
- **Measured before this shipped (2026-09-23):** with a second guild, a WGA guild officer could read the new team's members, add a player to it and reset its invite link, because `is_guild_officer()` asks about any guild, not the team's own. Site admin is platform-wide on purpose. This, the grants that refuse to work with two guilds, and the public reads (#1286) are what #1324 has to fix before the switch is opened.

No issue-comment discussion beyond #1226's own text.

## 2026-09-23 -- the invite-link join names a character it can check, not one the caller describes (#1319)

Shipped: 20260923211927_join_verifies_character.sql

The entry below shipped `team_invite_link_join()` taking the character as plain text, with a note that checking it against the caller's account was #1319's job. This is that check, and it changes the function's shape rather than adding a guard.

- **The caller names a character, and does not describe one.** The parameters are the code and a Battle.net id; the name, realm, class and spec are read from `public.characters` for the signed-in person, so the function has no way to express the bug. That is the shape `request_main_swap()` already uses, which answers "That character is not on your account" from the same table. Checking a typed name against the same table was the alternative and was dropped: it costs the same and leaves a guard someone can later move, where this leaves nothing to move.
- **The id is the Battle.net id, not `characters.id`.** It is unique, and it is what the join page already holds for every row of its picker, so the Edge Function that reads Battle.net needed no change.
- **The proof is the save.** `public.characters` is written only by `save_battlenet_characters()`, only from the `battlenet-characters` Edge Function, which holds the person's own Battle.net token, so a row there is a confirmed fact about who holds what. The join page now saves the picked character (with everything already saved, since the save replaces the whole set) and joins with its id. A newcomer has a `people` row from their first sign-in, so this works before they belong to any team.
- **The archived character is what made it urgent.** Removing a departed raider's membership clears the link on their archived characters, so nothing recorded whose they were, and the join brought one back onto the roster under whoever typed the name, with its attendance, loot and BoE history. `claim_character()` and `link_battlenet_roster_characters()` both refuse archived rows, so this function was the only path that could. Claiming an *active* unclaimed character was already possible through `claim_character()` and is not changed here.
- **One upsert, so a race cannot reach the insert.** The select-then-insert it replaces locked nothing when no row matched, so two joins on the same new name both reached the insert and the second surfaced the unique index as a raw duplicate-key error. It is now `on conflict (team_id, name_realm_key) do update ... where players.team_member_id is null or players.team_member_id = excluded.team_member_id`, with no row back meaning the refusal, as `add_signup_to_roster()` and `review_main_swap_request()` do.

## 2026-09-23 -- team_invite_link_join() joins a team through its link (#1264)

Shipped: 20260923132616_team_invite_link_join.sql

The join page could resolve a code but had nothing to call once the raider picked a character. Decided on #1264 (Kat, 2026-09-19): the link is the approval, so a live link puts the person straight on the roster with no officer step.

- **Guild membership is the `team_members` row.** There is no separate guild-membership table, and none was added: a person belongs to a guild through a team_members row on one of its teams, so inserting it is the "added to the guild" step. A separate table waits for guild-only links, which #1264 leaves out for now.
- **Discord is required.** `team_members.discord_id` is not null and the person is resolved from it, as in `claim_character()`. A Battle.net-only account is refused with "Connect Discord before joining a team"; the join page asks for it first.
- **Character handling follows `claim_character()` on the holder check and goes further on archived characters.** An unclaimed roster character is claimed and one held by another person is refused, active or archived, as in `claim_character()`. Reviving an archived, unlinked character is new: `claim_character()` and `link_battlenet_roster_characters()` both refuse archived rows, so this function is the only path that brings one back without an officer. A revived character starts a new stint like `add_signup_to_roster()` gives: on trial, a new join date, and the backup tank/healer, wishlist and BiS flags reset, since an officer granted those to whoever held it before. A new character is inserted on trial, like any new add. The character is still the caller's word, not checked against their account: #1319 tracks that, due before cutover. (Superseded the same day by the entry above: the character is named by its Battle.net id and resolved from `public.characters`.)
- **Always `'joined'` for now.** The active-character limit (#1259) does not exist. The join page already shows the "roster full" state; the limit check goes into this function when #1259 builds it.
- **Writes its own `audit_log` row** ('Joined via Invite Link'), like the BoE lifecycle RPCs, because `write_audit_log()`'s officer gate would refuse the raider calling it.

No issue-comment discussion beyond the decisions already on #1264.

## 2026-09-22 -- team_invite_link_revoke() turns a link off outright (#1264)

Shipped: 20260922203449_team_invite_link_revoke.sql

`team_invite_link_reset()` (#1264, shipped on #1316) only ever replaces a team's invite code with a new one -- there was no way to leave a team with no live link short of resetting to one and then letting it expire. Kat asked for an explicit "remove" while building the officer panel that calls both.

- **`team_invite_link_revoke(p_team_id)` deletes the `team_invite_links` row outright**, same gate as `reset()` (officer/team_leader/guild officer/site admin), same `write_audit_log()` call (`'Invite Link Revoked'`, empty detail). Revoking with no row present succeeds silently rather than erroring -- the caller's intent ("no link should exist") is already satisfied.
- No new RLS policy: the table still has no insert/update/delete grant to any API role, so this stays the only way to remove a row, matching how `reset()` is the only way to write one.

No issue-comment discussion for this one -- it's a small addition inside #1264's own scope, not a separate decision thread.

Shipped: 20260922121912_boe_rpc_own_audit_entries.sql

#766 made the BoE manager grant guild-wide and, to keep the client's `writeAuditLog()` call from failing for a manager with no officer role anywhere, added `is_boe_manager()` to `write_audit_log()`'s gate. That function takes every field from the caller, so the OR let a manager append an audit row for any team, action or target, well past the narrow money role the grant is meant to be -- filed as an investigation on #770 rather than fixed on a schedule, since three things bounded the reach (actor stamped from `auth.uid()`, `audit_log` is read-only, the read gate does not admit the grant). Picked back up 2026-09-22 as a prerequisite for the BoE Sales rebuild in the new app (#1305), which has no client-side audit-log pattern to port in.

- **The five lifecycle RPCs (`boe_record_listing`, `boe_record_sale`, `boe_mark_paid`, `boe_retire`, `boe_revert`) insert their own `audit_log` row directly**, in the same transaction as the mutation, rather than calling `write_audit_log()`. They are already `SECURITY DEFINER` running as postgres, so nothing about their own gate changes. Wording matches what the client used to send byte for byte (`format_boe_gold()`, a small SQL helper mirroring `formatGold()` in `js/boe-manage.js`, reproduces the thousands-separator formatting).
- **`boe_edit_item()` is new**, replacing the raw client-side `UPDATE` `saveBoeEdit()` (#874) used. That path turned out to share the same shape as the five RPCs -- gated by the same `is_boe_manager() or is_site_admin()` RLS rule, also calling `writeAuditLog()` afterward -- so dropping the OR without giving it an RPC of its own would have reintroduced the exact silent-failure bug #770 exists to fix, on a path the original investigation didn't cover. Same gate, same five columns the `check_boe_status_transition` trigger already admits from a direct UPDATE, and builds the same "changed which columns" wording the client used to build (`_boeEditChanges` stays on the client for the "nothing changed, don't call" guard; the detail string itself is now server-side). The raw-UPDATE route and its RLS policy are untouched.
- **`write_audit_log()`'s `is_boe_manager()` OR comes off.** `is_guild_officer()`'s OR (#607) stays -- a separate question, load-bearing for the player/attendance/bio writes it was added for, per #770's own writeup.
- **Entries stay human-readable strings**, not structured `jsonb`, to preserve today's wording exactly. A machine composing the detail now (rather than the client) makes structured `jsonb` a reasonable future call, but a separate one.

[Full discussion -> #770](https://github.com/katogaming88/WGA-Raid-Hub/issues/770), following up on [#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766).

## 2026-09-21 -- A team's season starts on its first raid night, derived rather than typed (#1269)

Shipped: 20260922000521_team_season_start.sql, 20260922123711_retire_season_dates.sql

Each team typed its own season start into Season Settings (`seasonStart`), and the attendance sync, the new-raider nudge, the onboarding checklist and the profile's date range read it; a typed `seasonEnd` bounded the same range. Decision 13 on #1189 (2026-09-20) made the season app-wide with one set of dates, the tier's own, so the per-team date goes. Read as they are, those readers would then count a late-starting team's first week against it, like marking a class absent for a term that started before the class did. Decided on the issue, 2026-09-20, the fallback settled 2026-09-21.

- **`team_season_start(p_team_id, p_season default current_season())` answers the team's own first raid night in the tier**: the earliest night the attendance sync filed from a Warcraft Logs report (`report_id` set, `report_excluded` false) inside the tier's `[starts_at, ends_at]`, else the tier's start date. A night an officer excluded is skipped; a row an officer typed by hand is not a report and does not move the start. The tier's start rather than the team's first scheduled night as the fallback (2026-09-21): nothing is counted before the first report, and the readers left before it (the nudge, the checklist) move by days between the two. `SECURITY INVOKER` over two public-read tables, so anon may call it, the way the public roster page already reads attendance. Null when no tier has started.
- **One definition for the site, the app and the archive.** `close_season()` writes the night as a closed tier's `start` (its `end` stays the tier's `ends_at`), so the books a close freezes and the live page count over the same window; the site loads it once per page and the app once per team. The attendance sync does not call it: the sync fetches reports from the tier's start and the night is a read on the rows the fetch produces.
- **The window's end is the tier's `ends_at`, and that is what the typed `seasonEnd` used to do.** A team set `seasonEnd` when it stopped raiding before the next tier went live; the tier's own end bounds every team's window now. `MID2` holds no end today, so nothing is bounded and the change is invisible. What to know before one is set: `currentSeasonCode()` answers the latest tier whose start has passed, whatever its end holds, so an `ends_at` written onto the live tier before the next tier's row exists closes the attendance window on that date and stops counting the nights after it. The two go in together.
- **Three pull requests, in this order.** First, the function, with `close_season()` writing it (`20260922000521`). Second, the sync fetches from the tier's start instead of the typed date. Third, the site and the app read the function, the Season Start Date and Season End Date blocks leave the Season tab, and the two keys leave every team's settings, closing the issue. The order is the dependency: every reader moves off the keys before the strip.
- **Production at the third merge** (re-read 2026-09-22, unchanged): teams 1, 2 and 3 each have their first synced night of Midnight Season 2 on 2026-08-18 (typed starts 08-11, 08-18 and none); team 4 has no attendance rows in the tier and reads the tier's 08-11. No attendance row exists before 08-18, so no percentage moves; the nudge and checklist stop treating a raider who joined between 08-11 and 08-17 as a mid-season join on teams 1 and 3. Two teams gain a window they never had: Immolation and Wrathless typed no date, so every reader that asked whether the season had started answered no for them and the new-raider nudge never fired; from the third merge it fires there like anywhere else.
- **Not moved with this.** `item_preferences.season` and the wishlist gate (#936). The tier's own dates (`seasons.starts_at`, `ends_at`).

[Full discussion -> #1269](https://github.com/katogaming88/WGA-Raid-Hub/issues/1269), Season milestone; the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

## 2026-09-21 -- The season is the tier: seasonName retires and the archive closes a tier's books (#938)

Shipped: 20260921192826_cleanups_read_current_season.sql, 20260921194720_close_season.sql, 20260921201717_retire_season_name.sql

`team_settings.config ->> 'seasonName'` named the season a team was on, typed on the Season tab or written by Start New Season, and it fed every stamp and scope the site made (loot imports, scores, priority, the item catalog's scope, the profile card's tier counts) and two database functions. Decision 13 on #1189 (2026-09-20) made the season app-wide: the tier the guild is raiding is `current_season()` (#933) in the database, the `seasons` read on the site and in the app, and nothing per team names it. So the key retires rather than converts, the last of the conversions #932 left for #933 to #938. Decided on the issue, 2026-09-21, measured against `main` 9525601.

- **Four pull requests, in this order, each closing one concern.** First, the two stale-priority cleanups read `current_season()` ([#1293](https://github.com/katogaming88/WGA-Raid-Hub/pull/1293), `20260921192826`). Second, the importer stamps codes ([#1294](https://github.com/katogaming88/WGA-Raid-Hub/pull/1294), no migration). Third, `close_season()` replaces the archive pair ([#1296](https://github.com/katogaming88/WGA-Raid-Hub/pull/1296), `20260921194720`). Fourth, the key leaves every config row and every site and app reader takes the tier (`20260921201717`), closing the issue. The order is the dependency: the old archive names its history entry from the key and the old Season tab writes it back after an archive, so the archive is replaced before the key goes, and the cleanups stop reading it before the strip would turn their read null.
- **`add_signup_to_roster()` and `review_main_swap_request()` clear the archived character's standing `priority_order` rows for `current_season()`.** Both had read the key through a `'^Midnight Season (\d+)$'` regex (20260828124142, and #942 step 5c after it). `regexp_replace` returns its input unchanged on a miss and null on an absent key, so the cleanup was skipped on every team with no name (production, 2026-09-21: teams 3 and 4) and would have matched nothing at the next expansion. Null only on a stack with no tier row, where there is nothing to clear. Same signatures.
- **The importer stamps codes.** `data/seasons.json` ranges carry a `code`, `seasonForDate()` answers with it and throws on a range without one, and both generated files open with a check that raises before the first insert when a stamped code is not a `seasons` row, rather than at the first foreign key a few thousand rows in. No migration.
- **`archive_current_season()` started a season as much as it closed one**: it blanked the name and the dates, emptied the raid list, and the site wrote the next tier's name back. `close_season(p_team_id, p_season, p_roster_snapshot)` only closes: it refuses a tier `seasons` does not hold, a tier that has not ended (its start on or after the current tier's, since `current_season()` is by start date) and a tier the team has already closed; it folds the tier's raids from `raid_zones`, `raid_encounters` and the team's `team_raid_progress` rows rather than from the team's raid list, so closing after the list has been rebuilt for the new tier records the right raids; the entry carries `code`, `name`, the tier's dates, `raids` and the roster snapshot; M+ exclusion, Bench and the BiS link reset as before; the audit entry is the function's own. `SECURITY INVOKER` like the function it replaces, so the `team_settings` write policy is the gate. `unarchive_season()` goes with it: nothing is started, so nothing is undone. The fold is the sync's record: a kill date typed by hand into the raid list and never synced is not in the entry, and a tier the sync never wrote progress for closes with no raids (Immolation and Wrathless for Midnight Season 1). The two history entries on production (both Midnight Season 1) gain `code` through `seasons.display_name`; `name` stays for display and for entries written before.
- **The key leaves every `team_settings.config` row**, and every reader takes the tier: `currentSeasonCode()` and `currentSeasonName()` on the site (`CURRENT_SEASON` in `js/common.js` goes with it), the `seasons` read in the app's `useCurrentSeason()`. The officer toolbar's season selector lists the tiers that have started with the current one marked, instead of the team's name plus its history. A missing jsonb key reads as null, not as a failed request, so the strip is one pull request with its readers (the two-PR rule from #935 is for a drop the live bundle would fail on).
- **Not moved with this.** The team's typed season dates and the attendance start (#1269, next). `item_preferences.season` and the wishlist gate (#936). Widening `set_team_season()` to team officers, and refusing an ended tier server-side there.

[Full discussion -> #938](https://github.com/katogaming88/WGA-Raid-Hub/issues/938), Season milestone; the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

---

## 2026-09-21 -- The signup season is the team_seasons row, and season_signups holds the tier code (#934)

Shipped: 20260921155314_season_signups_codes.sql

`season_signups.season` held display names (`Midnight Season 2`) referencing `seasons(display_name)`, and which tier a team took signups for was `activeSignupSeason` on `team_settings.config`, a name an officer typed as a number on the Season tab; since #939 `submit_season_signup()` found the switch row by that name. Decision 13 on #1189 (2026-09-20) made the season app-wide and left a team its two switches per tier and nothing else, so the key goes rather than converts. Third of the conversions #932 left for #933 to #938.

- **A team's signup seasons are its `team_seasons` rows with `signups_open`.** There is no separate key naming one of them: the officer picks the tier beside the Signups toggle (the `seasons` rows that have not ended, plus any the team still has open), the raider picks one of the open tiers on the form (a select only when more than one is open), and the Sign Up item, the guild cards and the app's cards show when any tier is open. The roster page's incoming tab is named after the tier when exactly one is open.
- **The column holds the code and references `seasons(code)`.** Seventy-eight named rows converted; the one row with no season (team 3, added 2026-07-12, submitted while its switch was on with no tier named) took the tier current on its submit date, `MID1`, the rule #937 used for `boe_items`. The column stays nullable, as #937 left `boe_items.season`: the fixtures insert without one, and a row submitted before the first tier has no tier to take.
- **`submit_season_signup()` and `get_own_signup()` take `p_season`.** The first refuses unless the team's row for that tier has `signups_open` (a display name matches no row and is refused the same way); the second answers with the caller's latest row on that tier. Passed as null, both mean the team's one open tier (the first refusing on none or several), which is what a browser on the old bundle asks for during the ten-minute window between the migration and the site publish (#1083). The old signatures were dropped before the new ones were created: `create or replace` with an added parameter leaves both, and PostgREST refuses an `rpc()` call it cannot resolve to one candidate.
- **`update_own_signup()` keeps an added row editable while the team's row for its tier has `signups_open`.** The 2026-08-07 change made an added row editable because "I'm looking at my added signup" and "signups for this season are still open" were the same fact by argument; the row makes them the same fact by construction.
- **`incoming_roster` joins `team_seasons` on the row's tier**, whichever way the switch is now, instead of `team_settings` on the key: officers close signups and then push the approved rows onto the roster, and the tentative roster stays on the public page across that gap, as it did while the key named the season. Its bypass-RLS shape is unchanged; #503 makes it a function after this.
- **The three dead keys left `team_settings.config`**: `activeSignupSeason`, read by nothing after this file, and `signupsOpen` and `wishlistOpen`, read by nothing since #939 and left for this file to remove. A missing jsonb key reads as null, not as a failed request, so one PR held (the two-PR rule of #935 is for a drop the live bundle would fail on). The old bundle's cost for the window: its Sign Up item, guild cards and officer toggle read closed, and its Season tab box, if saved, writes the dead key back.
- **Not moved with this.** `add_signup_to_roster()` reads the team's `seasonName` by regex, not this column (#938). Refusing an ended tier server-side: the select does not offer one, and `set_team_season()` still accepts any `seasons` code. Widening `set_team_season()` to team officers is a decision of its own.

[Full discussion -> #934](https://github.com/katogaming88/WGA-Raid-Hub/issues/934), Season milestone; the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

## 2026-09-21 -- A team's two season switches are a row per team and tier (#939)

Shipped: 20260921135215_team_seasons.sql

Decision 13 on #1189 (2026-09-20) made the season app-wide, so the per-team cycle table #939 was filed for is not built. What a team keeps per season is two switches, whether raiders can sign up and whether they can edit their wishlist; until now both were one key per team on `team_settings.config` (`signupsOpen`, `wishlistOpen`) with no season attached, so next tier's signups could not be open while this tier's wishlist editing was closed, and nothing recorded which tier a switch was for.

- **`team_seasons(team_id, season_code, signups_open, wishlist_open)`, one row per team and tier.** Public read like `team_settings`; no table write policy. `set_team_season()` is the only writer, gated the way `team_settings`' write policy is (the team's leader and site admins), refusing a tier `seasons` does not hold, keeping a switch passed as null, and writing the audit entries the site used to write from the client (Signups Opened and the other three), with the tier in the detail.
- **No row means both switches closed.** That is what every reader already did with an absent key (`submit_season_signup()`, the site, the app), so the rule moved where presence lives and nothing was minted for a team or a tier: not a jsonb default on `team_settings.config` (the 2026-09-05 body's ask, which `admin_create_team()` bypasses by inserting `'{}'` explicitly, and whose purpose, the null season stamps on teams 3 and 4, the rest of the milestone removes), not a row at team creation (two states, since nothing mints rows when a tier lands), not rows by construction from a trigger on `seasons` or `teams` (the writer-trigger shape #935 just removed, and a tier is Blizzard's calendar), not a defaulted view (a coalesce on a column already `not null default false`; after #934 and #936 every gate is an `exists()` on an open row).
- **Every reader and writer moved in the same PR.** The Signups toggle controls the tier `activeSignupSeason` names and the Wishlist Editing toggle the tier the Season View shows, else the live season, which is the tier a wishlist row is stamped with, so the gate and the stamp agree; the Sign Up button, the guild page's cards and the app's cards read the row the gate reads. A team with no tier to open (3 and 4 at the time) sees the toggle disabled and where the tier is set.
- **The backfill made a row only where a switch was on**, on the tier its config named: two rows (teams 1 and 2 on MID2). Team 3 had signups on with no signup season, so its signups had stamped null (the one null row #934 names) and its Sign Up button closed with this merge. The two config keys stay for the old bundle's cache window (a merge pushes the migration before the site, #1083); #934 strips them.
- **#250 stands corrected the other way.** Its "seasons are expansion-wide and need no `team_id`" was right for dates; the per-team part is these two switches, not a cycle.

[Full discussion -> #939](https://github.com/katogaming88/WGA-Raid-Hub/issues/939), Season milestone; the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

## 2026-09-20 -- bis_items is gone; the wishlist is the only BiS source (#935)

Shipped: 20260920234054_retire_bis_items.sql

`bis_items` was the Sheet-era BiS grid: one row per player per slot, picked by an officer, with an `obtained` flag. The wishlist (`item_preferences`) is where raiders have kept their BiS since 2026-08-07, and on 2026-09-05 the grid was retired rather than kept empty (beside #1032 and #1033, which made the wishlist a BiS pick or a Pass). Production held four rows, all on three players archived in July.

- **Two PRs, one deploy apart.** Since #1083 a merge pushes its migration before it publishes the site, and the live bundle read the table on every page load and wrote it on Mark Received, so one PR would have handed every browser still on the old bundle a failed read for up to ten minutes. PR #1274 (v3.146.0) took every read and write out of the site with the table standing; this migration, cut after that build had been live longer than the page cache, drops it. The same shape applies to any drop of a table the live bundle reads.
- **The drop takes everything that existed only for the table**: its two triggers, four policies, unique index, sequence and three foreign keys (the #932 key on `season` among them); `trg_self_received_sync_bis_obtained` and `sync_bis_obtained_from_self_received()`, which only ever ticked a `bis_items` row on an approval; `restrict_bis_items_update_to_obtained()`; and the `bis_items` branches of `generate_priority_order()` (the `bis` CTE and `has_bis_pick`), `archive_current_season()` (the snapshot and the wipe) and `wishlist_setup_status()` (the officer-bucket passes).
- **The self-received sync stops rather than moving to `item_preferences`.** That table has no `obtained` column, and whether a wanted item was awarded is already answered by `bis_demand_vs_awards` and `rclc_loot`. Decided on the issue, 2026-09-05.
- **History stays.** `seasonHistory` entries already written keep the `bis` snapshot they carry (the Season tab renders it when present); new archives write none.
- **Not moved with this.** `players.bis_link` and the BiS link submissions are unrelated. Who may see a raider's BiS List, now the wishlist's BiS tags and readable by the raider and the team's officers, is #1276; a raider's own tier-count refresh is #1275.

[Full discussion -> #935](https://github.com/katogaming88/WGA-Raid-Hub/issues/935), Season milestone; the first PR is [#1274](https://github.com/katogaming88/WGA-Raid-Hub/pull/1274).

---

## 2026-09-20 -- boe_items holds the tier code, and a find is stamped with the current tier (#937)

Shipped: 20260920160630_boe_items_season_codes.sql

`submit_boe_found()` stamped `boe_items.season` with the reporting team's `config->>'seasonName'` and nothing else, so a team that never ran Start New Season filed every find with no season (#922: eleven rows on production by 2026-09-20, all live submissions from the two teams with no `seasonName`). The picker on `boe.html` answered the same question a different way (that team's `seasonView` or `seasonName`, else the first listed team's), so what a raider was offered and what got stored disagreed. Second of the conversions #932 left for #933 to #938.

- **A find is stamped with `current_season()`, whatever the team's settings say.** Decision 13 on #1189 (2026-09-20) made the season app-wide with no team cycle, so the two-step rule this issue was filed with (the team's open cycle's tier, else the guild's) is one step, and the definition #933 minted is the one value. The picker reads the same function at page load (`rpc('current_season')`, callable by anon) and offers that tier's BoEs for every team; it no longer reads `team_settings` for a season or changes with the team picked, since a BoE is guild property and which team is reporting decides only where the row files. From 00:00 Eastern on a tier's start every find is the new tier's, and the picker offers the whole catalog until the sync files the new raid, the fail-open rule it already had for a tier with no zones.
- **`boe_items.season` holds the code and references `seasons(code)`.** Seventy-two named rows converted; the rows with no season take `current_season()` on the day each was found, which is the tier that was current when it was submitted. The column stays nullable: the function no longer produces a null on any day with a tier row, nothing else writes the column, and the row fixtures in the RLS suite carry none.
- **Not moved with this.** The importer (`scripts/import/tables/boe.js`) still stamps whatever name its `--seasons` file carries, so a BoE import would now be refused as a legacy loot import already is; #938's second pull request moved it to codes (`seasonForDate()` answers with the range's code, and the generated file opens with a check that every stamped code is a `seasons` row). The sold post's season totals, the column's first reader, are #918's follow-up.

[Full discussion -> #937](https://github.com/katogaming88/WGA-Raid-Hub/issues/937), Season milestone; the bug is [#922](https://github.com/katogaming88/WGA-Raid-Hub/issues/922) and the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

## 2026-09-20 -- raid_zones holds the tier code, and the current tier has a definition (#933)

Shipped: 20260920130020_raid_zones_season_codes.sql

The Season View dropdown read `raid_zones.season` and stored what it found, a display name, while every table the picked value went on to query holds the code; `generate_priority_order()`'s LEFT JOIN on `scoring` turned the mismatch into every player scoring null rather than an error (#923, latent because no team had set one). First of the conversions #932 left for #933 to #938.

- **`raid_zones.season` holds the code and references `seasons(code)`.** Three rows converted; the unique key `(wcl_zone_id, season)` stands. A Season View stored on `team_settings.config` converts with it, so the key holds a code by construction (no team had one set). The dropdown stores the code and shows `display_name`; `resolveSeasonViewCode()` returns a code on both branches and `resolveSeasonView()` a name on both, since it stamps `item_preferences.season` and `bis_items.season`, which keep names until #936 and #935. The scope check compares zones by code whether or not a Season View is set: with codes in the table, a team with none would otherwise have compared its season name, matched nothing and fallen open to every tier's items.
- **`current_season(p_on date)` is the latest tier whose start has passed on that day, by start date alone.** Decision 13 on #1189 (2026-09-20) made the season app-wide with one set of dates, no early rollover and dates by migration, so a tier stays current until the next one's migration lands and `ends_at` is not read. The default is today in Eastern; the argument is what makes it testable. Security invoker over the public read on `seasons`, executable by anon, authenticated and the service role. It ships here rather than with #937 because its first reader is now the progression sync.
- **`wcl-progression-sync` stamps a raid it has not filed before with `current_season()`, read once per run, for every team; a raid already on file keeps the tier it was filed under.** This supersedes the #932 paragraph that kept the syncing team's `seasonName` as the stamp: that reason was two teams on different cycles, which decision 13 retires. The kept tier is what makes launch day safe: every team's raid list still names the outgoing raid until an officer replaces it, and re-filing it under the new tier would duplicate its rows and pull it into the new tier's scope (found in review). A team with raids and no `seasonName` syncs; a day with no tier row writes nothing and says so in the response, since the key would refuse the row.
- **`fill_raid_night()` joins `seasons` on the code.** Body otherwise as #1216 left it.

[Full discussion -> #933](https://github.com/katogaming88/WGA-Raid-Hub/issues/933), Season milestone; the model decision is [#1189](https://github.com/katogaming88/WGA-Raid-Hub/issues/1189).

## 2026-09-17 -- A guild records its region and home realm (#1102)

Shipped: 20260917014626_guild_region_realm.sql

The new app's Guild home links to the guild on Raider.IO and the Armory. On the current site those are two WGA addresses written into `js/common.js`, which would send every other guild's visitors to WGA.

**Region and realm on the guild row, not the two links.** Both addresses are built from the region, the realm and the guild's name, so storing the three pieces keeps them from disagreeing, and the realm is also what the page's one-line intro names ("Three raid teams on Tichondrius"). A stored link would have to be edited by hand whenever the guild is renamed.

**Optional, and no new write path.** A guild with no region or realm shows no links. Nobody edits them from the app yet; WGA's are set by this migration, and a future guild settings page is where they would be written. The existing public read on `guilds` already covers the columns, so a signed-out visitor sees the links too.

**The realm is stored as the game spells it.** "Tichondrius", not "tichondrius": the page shows it. The app lowers it and replaces spaces with hyphens for the Armory address, and drops apostrophes, the way Blizzard's realm slugs do.

[Full discussion -> #1102](https://github.com/katogaming88/WGA-Raid-Hub/issues/1102).

## 2026-09-16 -- Raiders see their teammates' raid-night answers, but not the notes (#1102)

Shipped: 20260916142703_team_rsvp_answers.sql

The new app's Calendar page shows who is out and who is late for a raid night, with counts. `raid_rsvps` only let a raider read their own row, so on the current site a raider sees every teammate as Present even after one has said they are absent.

**Kat's call: answers yes, notes no.** A raider sees that Voljin is Absent and Kat is Late, and the real counts. The note ("Out of town") stays with officers, since the note box has always said it is for officers. Someone signed out sees the schedule only: no names, answers or counts.

**A function, not a wider read on the table.** Row-level rules pick rows, not columns, so letting raiders read teammates' rows would hand over the note too. `team_rsvp_answers(team, from, to)` returns player, night, status and when it changed, and nothing else. Officers keep reading `raid_rsvps` directly.

**Who counts as "on the team": an active character there.** A membership row can outlive a raider's last character, and a raider who has left should not keep watching the team's attendance. The team's officers and leader, guild officers and site admins are also answered.

**It refuses rather than returning nothing.** A signed-out or outside caller gets an error, so the page can tell "nobody has answered" from "you can't see this". The range is capped at 62 days because the page reads a month at a time.

[Full discussion -> #1102](https://github.com/katogaming88/WGA-Raid-Hub/issues/1102).

## 2026-09-16 -- A raider can ask for a main swap any day, and an officer approves it on the roster (#631, #942 step 5c)

Shipped: `20260916010611_main_swap_requests.sql`.

Until now the only main swap was a field on a season signup, so it existed only while a signup window was open. A raider who rerolled mid-tier had no way to ask for one.

Kat's calls on 2026-09-16:

- **The raider asks, an officer approves.** Never a self-service roster write. `request_main_swap()` records the ask; `review_main_swap_request()` does the work.
- **They ask with a character already listed as an alt** (step 5b), so Blizzard's own character list is the proof they own it. A character not on the list is added by choosing alts first.
- **Officers review it on the roster page**, in a panel above the team, because the officer Reviews page is still a placeholder in the new app. It moves there when that page is built.
- **Approving keeps today's behaviour.** The old character leaves the roster and keeps its loot and raid history; the join date and attendance move across. Kat wants the "every character stays on the books with a Main tick" idea from #631 instead, but as a change made **just before cutover** (#1105), so the current site keeps working unchanged until then.

Settled while building it:

- **The swap steps are `add_signup_to_roster()`'s, minus the signup.** Same on-conflict revival (a character they played before keeps its id, so its loot stays attached), same join-date carry, same attendance move that skips a night the destination already has, same live-season `priority_order` clear, same two audit lines. Sharing the code was rejected for now: the signup path is the current site's and moves at cutover, and a shared function would have to serve both call sites through that move.
- **The spec is the raider's to pick, not Blizzard's to report.** The saved character carries whatever spec Blizzard last saw it in, which is often not the one they mean to raid. The dialog offers that spec first but lists the class's others, and the database refuses a spec of another class.
- **One request per person per team**, as a partial unique index as well as a named refusal, so a double submit cannot make two.
- **The approval notice is inserted straight into `notifications`** rather than through `notify_player()`, whose own check admits a team's officers and site admins but not a guild officer, who may review this.

---

## 2026-09-15 -- Who sees alts, and loot totals that follow the raider across mains and teams (#942 step 5b)

Shipped: `20260915185428_loot_from_earlier_characters.sql`.

Kat's calls on 2026-09-15, made on the mockups (https://claude.ai/artifact/VM16JDUUWPVC9YaQV19eRY):

- **Alts show only to the raider and their team's officers**, never on a public page. The `characters` read rules from step 5a already match (the person, officers of their teams, site admins, guild officers), so no rule changed.
- **Choosing alts works on a computer only**, using the `useTouchScreen()` switch the wishlist editor uses.
- **Alt rows on the officer roster start hidden**, behind a Show alts switch. An "N alts" count beside the raider shows either way.
- **A character someone else claimed says "claimed by another player"** and "Ask your officers to check the claim", without naming who. The raider's own team's officers take it up with the other team.
- **Loot on an earlier main this season counts toward the raider's total**, because officers weigh it when awarding. Only the total changes (the new app's roster Items column and the profile's items received, with old-main items marked "on <character>"). The Priority List's "already has this item" check stays per character, and the current site is unchanged.
- **Loot from a team the raider left mid-season carries over too**, listed and marked "on <team>". Leaving means their character there is archived. Someone on two teams at once keeps a separate total on each, so the 2026-09-14 "officers see only the other team's name" rule stands.

Settled while building it:

- **Which characters belong to the same person is not public, so one function answers it.** Loot and roster rows are readable by anyone, but a team's officers read only their own team's memberships. They cannot see the Hellfire membership behind a raider's old Hellfire character. `earlier_characters(team_id)` (security definer, authenticated only) returns pairs of roster row and earlier character: archived characters of the same person, either on this team or on a team where the person has no active character. It returns every pair to the team's officers, site admins and guild officers, only the caller's own pairs to anyone else, and nothing when signed out. The app reads the loot itself by player id.
- **The Battle.net token stays in memory.** The picker needs the token from a Battle.net round trip. The app keeps it only for that page load, and only when the last round trip went to Battle.net (a Discord sign-in leaves Discord's token). Without one, "Choose alts" goes to Battle.net and back. A person with no Battle.net login is sent to connect it instead, since a Battle.net sign-in there would make a new account.

---

## 2026-09-15 -- Alts come from the Battle.net character list: raiders pick them, roster matches link on their own (#942 step 5, #1162)

Shipped: `20260915171944_battlenet_characters.sql`.

Kat's calls on 2026-09-15:

- **A raider picks which characters to show as alts.** The list is their max-level characters (Midnight's level cap, 90), and only what they pick is saved, in a new `characters` table on the person. Rejected: saving every max-level character automatically (clutter), or every character at any level (47 on one tested account).
- **A roster character on their Battle.net list is linked to them on its own.** If Grihz-Illidan is on Phoenix's roster and unclaimed, connecting Battle.net links it, with no claim step. Blizzard's list is the proof of ownership, stronger than the claim dropdown, which lets anyone pick any unclaimed character.
- **The any-time main swap request (#631) is its own change, next.** It needs an officer approval screen.

Settled while building it:

- **The browser never writes characters.** The `battlenet-characters` Edge Function takes the Battle.net token, asks Blizzard whose it is (`oauth.battle.net/userinfo`) and refuses unless that is the Battle.net login linked to the caller: a refused Connect still leaves a working token in the browser (#1162's 2026-09-14 test). It then reads the character list itself and calls three service-role-only database functions. Picked ids from the request are kept only when they are on the caller's own list.
- **A character someone else already claimed is reported, never moved.** `link_battlenet_roster_characters()` answers `claimed_by_someone_else` and leaves it for an officer. An archived roster row is not linked.
- **No Discord, no membership, until cutover.** A membership still needs `team_members.discord_id`, so a Battle.net-only person is told `needs_discord` for a roster match rather than linked. Step 6 removes the need.
- **A saved character can move people.** A Blizzard character id is unique, so saving one another person had saved moves it: the token has just shown whose it is.
- **Who reads characters matches who reads `people`** (the person, officers of their teams, site admins, guild officers). Whether alts show on public pages is decided with the roster and profile screens in the app part of this step.
- **The token is never stored or logged**, only sent to Blizzard for the one request.

---

## 2026-09-15 -- The notification inbox belongs to the person; preferences stay on the account (#942 step 4)

Shipped: `20260915170855_inbox_belongs_to_person.sql`.

Step 4 of the #942 plan, reshaped before it was built. Kat's calls on 2026-09-15:

- **The inbox belongs to the person.** A raider sees notifications on every character they hold, archived ones included. Before this, a main swap archived the old character (still linked to them since #941) and its notifications vanished from their bell. On production that was 21 notifications on archived characters, 12 held by someone who can still sign in.
- **Old ones arrive read.** The migration marks the existing notifications on archived characters read (6 were unread), so nobody gets a bell badge for old messages about a character they swapped away from. Chosen over showing them unread, and over keeping today's current-character-only inbox.
- **`account_preferences` stays keyed by the sign-in account**, not moved to the person as the plan said. The account id does not change when Battle.net and Discord are linked to it, and `account_preferences.auth_user_id` is not a column cutover drops, so moving it would change the sign-in code on both sites for no gain.

Settled while building it:

- **No `notifications.person_id` column.** A notification stays addressed to a character; the read and mark-read rules decide whose inbox it is by asking the person through `my_player_ids()`, the archived-inclusive counterpart of `my_active_player_ids()`.
- **Only the inbox widens.** Every other raider-own-row rule (wishlists, BiS obtained, streamer, self-received, RSVPs, BoE reads, the bonus roll target) keeps `my_active_player_ids()`, so an archived character's own rows stay read-only.

---

## 2026-09-15 -- Every team access check finds the caller through their person, and a membership's account is always its person's (#942 step 3)

Shipped: `20260915161042_person_predicates.sql`.

Step 3 of the plan in the 2026-09-14 entry below. Settled while building it:

- **Every reader moves; writers do not.** `my_team_role()`, `my_officer_team_ids()`, `my_leader_team_ids()`, `my_active_player_ids()`, `is_own_player()`, `is_any_team_officer()`, `is_team_leader_anywhere()`, the `team_members` self-read rule, and the twelve functions that looked a member up by `team_members.auth_user_id` or `discord_id` now go through `person_id`. Functions still write `discord_id` on a new membership, because the person is resolved from it. At cutover (step 6) nothing reads the two copies and they can go.
- **Nobody's access changes, and production was checked first.** On 2026-09-15 all 72 memberships' `auth_user_id` and `discord_id` matched their person's (read-only query). The migration refuses to run if any differ.
- **The copies are kept by trigger, not trusted.** `set_person_from_discord_id()` now also sets `team_members.auth_user_id` from the person on every write, and `copy_person_account_to_members()` carries a person's account change onto their memberships. The copy stays for the current site, which filters its own memberships by `auth_user_id`. The link trigger no longer updates `team_members` itself.
- **Behavior change, on purpose: a membership's account can no longer be set by hand.** A team leader could write `auth_user_id` on a row in their team and bind that membership (and its role) to any account. Whatever is written is now replaced with the person's account. It follows that two old code paths had no state left to handle, and were removed rather than kept as dead branches: `claim_character()`'s refusal of a row linked to another account (#1117), and `admin_grant_team_role()`'s repair of a row whose account was never filled in. A re-grant of the same role is now always refused, still saying so when no account holds the Discord id yet.
- **Whoever reads a membership reads its person.** A new read rule on `people` lets an officer or team leader of a team, a site admin or a guild officer read the people behind that team's memberships. They could already read those memberships' Discord id and account copies, so nothing new is exposed. It is needed because `add_signup_to_roster()` runs as the calling officer and now joins `people`.
- **`my_person_id()`** is the caller's person, the one new helper. Rules call it wrapped, once per query, like the #1106 helpers.
- **Not moved in this step:** `season_signups.auth_user_id` (the signup's own record of its submitter, not a membership copy); `account_preferences` and `notifications` (step 4); `optional-rsvp-reminders`, `boe-sold-webhook` and the bot, which read `team_members.discord_id` or the `boe_managers` view with the service role and keep working through the copies until step 6.

---

## 2026-09-15 -- One guild_grants table holds the site admin, guild officer and BoE manager grants (#942 step 2)

Shipped: `20260915092357_guild_grants.sql`.

Step 2 of the plan in the 2026-09-14 entry below. Settled while building it:

- **A grant is a row: person, guild, grant type.** `guild_grants (person_id, guild_id, grant_type)`, with `grant_type` one of `site_admin`, `guild_officer`, `boe_manager`, unique per person per guild per type. The three tables were the same table three times, each with its own admin trio, link-trigger branch and read rules; a fourth guild-wide grant is now a new value.
- **Nobody's access changes.** The read and write rules move across as they were: site admins read and write every grant, any officer or team leader reads the BoE manager grants (#766), and nobody else reads any. `is_site_admin()`, `is_guild_officer()`, `is_boe_manager()` and the nine `admin_*` functions keep their names, arguments, results and error wording.
- **A grant has no account column; it reaches the account through the person.** The migration refuses to run if any grant's own `auth_user_id` differs from its person's, which is the check that "reads the person's account" answers exactly as "reads the grant's account" did. `link_auth_user_to_member()` no longer updates the three grant tables.
- **The old names stay as read-only views until cutover**, readable only by the service role and the read-only database role. Nothing in either site reads them (the current site's admin page uses the `admin_*` functions); `boe-sold-webhook` reads `boe_managers` with the service role and moves off it when the views are dropped in step 6. Writes through them were not kept: only fixtures wrote the tables directly, and they now write `guild_grants`.
- **Every grant sits on the one guild, and the checks still ask "in any guild".** Scoping a check to the guild being viewed is multi-tenancy (#1045). A new grant goes to `only_guild_id()`, which refuses once there is a second guild, as `admin_create_team()` does. This is the guild that the 2026-09-13 addresses entry said these grants would get here.
- **One body per operation.** `admin_list_grants(type)`, `admin_grant(type, discord_id, label)` and `admin_revoke(type, discord_id, label)` hold the logic; the nine named functions are one-line wrappers, so the three copies cannot drift. The wrappers are what `authenticated` can execute; the shared bodies are not.
- **Audit rows keep their action names** (`site_admin_granted`, `boe_manager_revoked`, ...) and target types. Their `target_id` is now a `guild_grants` id; older rows name the old table's id. Neither resolves to a name in the Admin tab's log, which reads the Discord id from `detail`.

---

## 2026-09-15 -- The gear sweep records its outcome on site_settings, one column per trigger (#1174)

Shipped: `20260915003743_site_settings_gear_sync_runs.sql`

The daily `blizzard-gear-sync` sweep wrote nothing on 2026-09-12 to 09-14 and nothing in the database said so (#1095): `cron.job_run_details` reports whether pg_cron queued the request, `net._http_response` holds a 5 s timeout for a function that runs 13 s, and `player_equipped_gear.synced_at` moves on any write, so one sync by hand erases the evidence of the missed mornings. The function's dashboard log was the only record, read by a person after the fact.

- **The function writes its outcome to the settings row at the end of every run**, in its `finally`: `trigger`, `started_at`, `finished_at`, `synced`, `skipped`, `teams`, `players` and `error` (the first message, capped at 300 characters, or null). One row, the last run: `site_settings` is where the guild-wide singletons already live (`maintenance_mode`, `guild_officer_bios`, the BoE payout constants), and the Admin tab reads the row already. A new table for one value was rejected.
- **Two columns, `gear_sync_last_cron_run` and `gear_sync_last_officer_run`, not one key.** The issue asked for one. An officer's "Sync Gear Levels Now" (or a single-player sync) writing the same key would reset the sweep's age, which is exactly how `synced_at` hides a dead cron today. Each trigger keeps its own column, the Admin tab warns from the cron one, and each write is a plain column update by the service role rather than a read-modify-write of one jsonb value.
- **Public-read, function-written.** The row's SELECT policies already cover any column on it, so the error text is stored as the message alone. The writer is the function's service-role client, the first writer on this table that is not a SECURITY DEFINER RPC; on the officer path that client is created after the caller's authorization check, because the caller's own JWT cannot write the row.
- **The age is the net, not the error field.** A repeat of 2026-09-14 that is still answering 504 at the sweep's end fails the record write too, and the previous day's record stays; the Admin tab warns at 36 hours from `finished_at`. When PostgREST has recovered by the end, the record carries `synced = 0` and the first message.
- **A run that synced nobody is not healthy, and a run that cannot read the track table does not write.** From the review of PR #1196. Blizzard refusing every character (a 429, an expired token, an outage) used to record `synced 0, skipped 55, error null` and read as a normal morning; now any refusal other than a 404 is the run's error, and the tab warns on `synced = 0` with `players > 0` whether or not a message was recorded. A failed read of `track_bonus_ids` used to fall back to the item-level guess for every item and record clean; now it throws before the first upsert, since the previous run's tracks are right and guessed ones are the misclassification `20260913013949_track_bonus_ids_and_equipped_bonus_list.sql` measured (286 Hero items read as Myth). An empty cron column warns too, because after the first day it means the recording has never worked. A single-raider sync writes no record: the officer column is the last whole-team sync, and a one-raider record would read as one.
- **Not here:** the same record for `twitch-live-check`, `wcl-progression-sync` and `optional-rsvp-reminders`, which share the shape; a bounded retry inside the sweep, which waits on the 10:00Z window being measured (#1095).

[Full discussion -> #1174](https://github.com/katogaming88/WGA-Raid-Hub/issues/1174), Officer Tooling Improvements.

---

## 2026-09-14 -- seasons is a table, every season column is a foreign key to it, and raid_zones keeps the team's stamp (#932)

Shipped: `20260914224520_seasons_table.sql`

Season lived in three places and none of them was a table: `CURRENT_SEASON` in `js/common.js` for the tier, keys on `team_settings.config` for a team's cycle, and a free-text stamp in two formats on fourteen columns with no CHECK, no foreign key and no default (`docs/season-inventory.md`, #931). A misspelt or invented season was written and found later by a report that came back empty. The first structural step of the Season milestone gives the tier a table and points every column at it, changing no stored value and no client.

- **`seasons(code primary key, display_name unique, starts_at, ends_at)`, one row per raid tier, global.** Tiers are Blizzard's calendar, the same for every guild, so there is no `guild_id`; a team's own cycle was to be #939's `team_seasons` (which became the two switches per tier instead, decision 13 on #1189, shipped 2026-09-21). Two rows, dated from `data/seasons.json`. Public read, `claude_readers`, no write policy: a tier is a migration.
- **Every season column references it, formats unchanged.** The nine code columns (`priority_order`, `rclc_loot`, `scoring`, `player_wcl_season_perf`, the three priority dismissal and marker tables, `tier_token_map`, `track_bonus_ids`) to `seasons(code)`; the five name columns (`bis_items`, `boe_items`, `item_preferences`, `raid_zones`, `season_signups`) to `seasons(display_name)`, which is unique and so a valid target. Nulls stay allowed where they were (#937 and #934 own those). #933 to #938 convert the name columns to codes on top of the keys.
- **Tiers do not overlap: `seasons_no_overlap`, an exclusion constraint over `daterange(starts_at, ends_at, '[]')`.** An open-ended row runs without end, so a second one is refused until the outgoing row is closed, which keeps the issue's "one open-ended row is the current tier" as a database fact; a window that overlaps a tier is refused the same way, which a one-open-ended index would not have done.
- **`raid_zones` keeps the syncing team's `seasonName` as its stamp, and no `current_season()` ships.** The first build read the guild's tier once per run and stamped every team's raids with it, on the reading that a raid belongs to a tier whatever cycle a team has clicked. The review after green found what that breaks: `raid_zones` is one row per `(wcl_zone_id, season)` shared by every team, and the site scopes a team's progress by the team's own `seasonName` (`isItemInSeasonScope()` through `currentZoneIdsForSeason()`), so the differing cycle names are what keep two teams on different cycles apart through the shared rows. Under the guild stamp an early roller's next-tier raids would land under the outgoing tier for everyone, and a late roller's would vanish from its own scope, at exactly the staggered rollover decision 3 of this milestone exists for. Nothing shows today because both syncing teams are on the same tier. So the stamp stays the team's name until #933 gives it codes and #939 gives the cycle a row, and the guild's current tier gets a definition with its first reader (#937), not before. What did change in the sync: a team with raids and no `seasonName` is skipped instead of stamped `Unknown`, which the key would refuse.
- **The next tier is a migration that closes the outgoing row and inserts the new one, landed before any team names the tier.** From here a season name with no row refuses that team's signups (`activeSignupSeason`), finds, wishlist picks and BiS placeholders (`seasonName`) with a constraint error until the row exists, which is the refusal the issue asked for, on an input officers type. Nothing on production is in that state. `docs/updating-fetch-items-for-new-tier.md` carries the step; #934 and #938 give those paths their own refusals when they convert them.
- **The seed carries a closed `seed-season` row and each RLS fixture seeds its own season.** Fifteen files stamped seasons the table would not hold; `seedSeason()` in `tests/rls/helpers.js` is the fixture, inside the test's transaction, one day per call so two never overlap.

[Full discussion -> #932](https://github.com/katogaming88/WGA-Raid-Hub/issues/932), Season milestone.

---

## 2026-09-14 -- A person is a row, alts hang off it, and the build runs in six steps (#942)

Shipped: `20260914221328_people_table.sql` (step 1), `20260915092357_guild_grants.sql` (step 2), `20260915161042_person_predicates.sql` (step 3), `20260915170855_inbox_belongs_to_person.sql` (step 4, reshaped: inbox only), `20260915171944_battlenet_characters.sql` (step 5, storage and Edge Function; the app screens and the main swap request follow), all in entries above. Step 6: not yet, #942.

The re-plan is on [#942](https://github.com/katogaming88/WGA-Raid-Hub/issues/942#issuecomment-5673595252). Kat's calls on 2026-09-14:

- **An alt is a character listed on the person, not a roster row.** Grihz's main is his roster row, with attendance, a Priority List spot and loot; his Evoker alt shows under his name with class, spec and item level and none of those. When an officer makes an alt the main, it becomes the roster row the way a main swap does today. Rejected: an `is_alt` flag on `players`, where every roster, attendance, priority, import and export read has to skip flagged rows and one missed read puts an alt into loot priority. This answers #631's open question.
- **Someone on two teams (#486): officers of either team see the other team's name and nothing else from it.** Each team keeps its own roster row and history, one person above both.
- **`team_members` id 8 is kept**, the Immolation officer listed by Discord id who has never signed in. They become a person with no account, and their access starts on first sign-in as it would today.

Settled while building step 1:

- **Every sign-in account is a person, and so is a Discord id listed before its owner signs in.** The person hangs off the account (the Battle.net decision above), with `discord_id` on the row as the key a listing uses until the account arrives.
- **`team_members` stays and becomes the membership table**, rather than a new `team_memberships`. It already is the membership half; renaming it breaks the current site for nothing before January. It gains `person_id` now and loses `discord_id` and `auth_user_id` at cutover. It is still not promoted into the person.
- **`person_id` is kept by trigger, not generated.** A generated column cannot read another table. The trigger overwrites it on every insert and update, not only when `discord_id` changes, because team leaders write `team_members` directly and a `person_id` they picked would outlive the steps that start trusting it.
- **`players` gets no `person_id`.** A character reaches its person through `team_members`, as it reaches its account today; a second path would be a second thing to keep level.
- **Battle.net first, then a listed Discord id: the listed person wins.** The grants point at it, so it takes the account and the account's own empty person is deleted. Nothing else points at a person in step 1; step 4 moves preferences onto the person and has to carry them across in that branch.
- **A person with neither an account nor a Discord id deletes itself**, which is what discarding an empty Battle.net sign-in leaves. The account FK is `on delete set null`, so deleting an account never takes a listed person or their grants with it.
- **Clients read their own row and write none**, the same no-write-rule shape as `notifications`.
- **A Discord identity is never unlinked from an account** (Kat, 2026-09-14, from Rex's review of #1191). The link trigger only handles an identity appearing. If an account could drop its Discord id and link another, the old id would stay on its person, the new id would create a second person with no account, and the next account to link the old id would get no person at all. Nothing unlinks today, so the rule costs nothing now: the new app does not offer `unlinkIdentity` for Discord. Rejected for now: a delete trigger on `auth.identities` that detaches the person. Revisit it only if switching Discord accounts becomes something people need.

---

## 2026-09-14 -- The roster shows attendance and items awarded to officers only (#870)

Shipped: no migration; the new app's Roster page (#870 part 2).

The approved design had Attendance, Items and BiS obtained columns on the roster. Kat's call: showing another raider's items awarded "is not good, as it can cause drama", and attendance the same.

- **Attendance and items awarded are officer-only columns.** Raiders and visitors see name, spec, item level, tier and tags. Both tables stay publicly readable, as they are for the profile and the current site; this decides what the roster offers, and the page does not read them for anyone but an officer.
- **BiS obtained is not on the roster.** It comes from wishlists, which only officers and the raider can read; it belongs with officer tools.
- **Spec icons are bundled with the app**, Blizzard's own art saved from Wowhead's icon server, rather than loaded from Wowhead on every visit.

[Roster -> #870](https://github.com/katogaming88/WGA-Raid-Hub/issues/870).

---

## 2026-09-14 -- A raider reads their own M+ exclusion requests, a Pug raid report is not held for saying "raid", and an Other report needs a note (#868)

Shipped: `20260914201423_mplus_exclusion_requests_own_read.sql`, `20260914201439_submit_self_received_pug_raid_note.sql`

Kat's calls while building the profile's two forms (#868 part 4).

**Measured on prod before deciding (2026-09-14).** Three M+ exclusion requests ever: one approved, two rejected, none re-submitted, and requests are closed on both teams. Mark Received took about 157 reports in 40 days, all but 12 approved.

- **A raider reads their own M+ exclusion requests, every status.** Only officers could read `mplus_exclusion_requests`, so the current site's profile showed "Rejected" and the officer's note from a read that returned nothing to the raider it was about. The new rule matches "Raiders read own self_received_requests", in the once-per-query shape (#1106).
- **A Pug raid report is not sent to review for mentioning "raid".** Pug raid is a Mark Received source now (the 2026-09-14 entry below), and its note will say "raid"; the source already says it was not a guild raid. Other still goes to review, and only the raider's own character auto-approves.
- **An Other report needs a note** (Kat's follow-up). Other goes to an officer, and a report with no note gives them nothing to judge it by. Both sites' forms require it, and `submit_self_received()` refuses one without it. Every other source stays optional.
- **Both forms work on a phone.** Each opens in a dialog with a Submit and a Cancel, so a stray tap saves nothing. The computer-only switch (the entry below) is not used for them.

[Player profile -> #868](https://github.com/katogaming88/WGA-Raid-Hub/issues/868).

---

## 2026-09-14 -- Officer gates settle the null from my_team_role() with coalesce, and an invariant holds the line

Shipped: `20260914172704_officer_gates_coalesce_missing_membership.sql`

Tracking issue: [#752](https://github.com/katogaming88/WGA-Raid-Hub/issues/752).

- **Three gates compared `my_team_role()` bare, and the null opened them.** `my_team_role(team_id)` is null for a caller with no `team_members` row on that team, `null = 'team_leader'` is null, and `if not (false or null)` never raises. `direct_mark_received()` (the filed case), `admin_grant_team_role()` and `admin_revoke_team_role()` (#910, which landed after the issue was filed) had it; every other gate already wrapped the comparison in `coalesce(..., false)`. Measured before the fix: an account with no role anywhere granted itself `team_leader` on a team, and the audit-log call that follows the insert admitted it as that team's leader. Production's audit log shows one grant since the path landed, by a site admin.
- **The null stays in `my_team_role()`; the gate is where it is settled.** Returning an empty string or raising for no row would change 22 callers, the #1106 rule helpers and the policies that read `is not null`. Coalescing at each comparison is the shape the siblings already had.
- **T6 in `tests/rls/function-invariants.test.js` fails any function body that compares `my_team_role()` without `coalesce`.** `resolve_person()` is the named exception: its comparison sits in a WHERE clause, where a null excludes the row as false does. A future exception needs the same reasoning written into its migration.
- **The #910 entry below said the null closed the gate; it opened it.** Only a site admin can open a rosterless team because nobody holds a row on such a team, not because of the null.

[Full discussion -> #752](https://github.com/katogaming88/WGA-Raid-Hub/issues/752)

---

## 2026-09-14 -- Editing can be limited to a computer, and the wishlist is read-only on phones and tablets

Shipped: no migration; `app/src/lib/device.ts` and the wishlist editor (#868 part 3). A rule for the new app's pages, logged here with the wishlist decisions it came from.

Kat's concern: on a phone, a stray tap can mark the wrong item BiS or Pass.

- **A site-wide switch, chosen per page.** `useTouchScreen()` tells a page it is on a phone or tablet. The wishlist editor uses it now. Mark Received, the M+ request form and officer tools decide for themselves when they are built.
- **Judged by the main pointer, not the screen width** (`(pointer: coarse)`). A computer browser that is narrow or zoomed far in, as low vision users do, still edits; screen width would have locked them out. Tablets are treated as phones. A touch-screen laptop keeps its trackpad as the main pointer and edits.
- **The wishlist stays visible on a phone:** slots, picks and marks show, the BiS and Pass buttons are disabled, and a note says editing works on a computer.

---

## 2026-09-14 -- The new wishlist editor has no notes, and adds no M+ or crafted picks until real items exist (#868)

Shipped: no migration; the editor, in the new app only (#868 part 3). `item_preferences.note` and the placeholder rows stay until cutover.

**Measured on prod before deciding (2026-09-14).** 330 wishlist notes from 51 raiders, most of them naming the M+ or crafted item behind a generic pick ("Arcanoweave", "Silvermoon Argent's Sneakers"), a few noting another spec ("Bis if I need to play Outlaw"). 289 generic picks: 172 M+, 113 Crafted, 4 Catalyst.

- **No notes.** The editor is BiS or Pass only. Existing notes stay in the table and are not shown. The real items from #1166 replace what most notes were for.
- **M+ and crafted picks wait for #1166.** Existing generic picks show read-only on their slot. Marking a raid item BiS for that slot replaces the generic pick, as on the current site.
- **A replaced BiS pick is unmarked**, not kept as 2nd Choice, following #1032.
- **Rows keep the current site's shape** so both sites read the same data until cutover: no slot saved for a one-item slot, the slot named for rings, trinkets and weapons. The editor does not write the current site's copy of a ring or trinket BiS into the other slot (`synced_bis`); `generate_priority_order()` reads one row per item either way.
- **A ring or trinket is BiS in one of its two slots, and a Pass covers both.** Six Phoenix raiders saved both BiS trinkets under Trinket 1 on the current site; when one slot holds two and the other none, the later pick reads as the other slot's. The profile's wishlist count reads picks the same way, so a ring counts for one slot, not two.

[Player profile -> #868](https://github.com/katogaming88/WGA-Raid-Hub/issues/868), [real M+ and crafted items -> #1166](https://github.com/katogaming88/WGA-Raid-Hub/issues/1166).

---

## 2026-09-14 -- Mark Received is for gear from outside guild raids, and the wishlist names real M+ and crafted items (#868)

Shipped: not yet. Decisions only; built with the player profile in the new app (#868, #1102), the catalog half in #1166, and the placeholder switch at cutover (#1105).

**Measured on prod before deciding (2026-09-14).** Mark Received is used: 144 approved receipts since 2026-08-07 from 35 raiders overall, mostly Crafted (48), Bonus Roll (33), Great Vault (29) and M+ (25), all approved instantly. The confusion is guild raid drops. Of 17 entries filed under "Other", officers rejected 11: eight say outright they were guild raid drops the importer already records ("awarded in raid", "award through RCLC", "Given by loot council"), two have no note, and one is a traded piece. The approved "Other" entries were real outside-raid sources: Torbjorn's Heroic legs from a weekly quest, Soulcialist's boots from a pug raid, Voljiin's trinket from Timewalking, Neldreth's gloves from a Curio.

**Mark Received becomes "got it outside a guild raid."**

- Instant sources: M+, Great Vault, Crafted, Catalyst, Bonus Roll, **Weekly quest** and **Pug raid**. The last two are new, taken from the approved "Other" entries.
- **Other stays and still goes to officer review**, for the rare real cases (Timewalking, a Curio, a piece someone traded, like Bearsdh's gloves from Twan's token).
- The form says guild raid drops show up on their own after the loot import, which is the mistake behind most rejections.
- `submit_self_received()`'s note check (a note containing "raid" is held for review) is revisited when Pug raid becomes a source, so a pug raid entry is not held for saying "raid".
- A receipt still takes the raider off that item's Priority List, as today.

**The wishlist names real M+ dungeon and crafted items (#1166).** The catalog holds raid loot only, and 50 raiders use the generic `M+` pick (151 slots), with 95 `Crafted` picks. Kat chose importing each season's dungeon pool and crafted gear so a slot names the actual item, over keeping the generic picks, accepting a per-season catalog refresh. These items are BiS picks and Mark Received targets and never get a priority number. The generic `M+`, `Crafted` and `Catalyst` placeholder rows are removed at the same cutover switch as #1032's, and raiders re-mark the real item.

**BiS Source (`players.bis_link`) is dropped from the profile**, as #868 already stated.

[Player profile -> #868](https://github.com/katogaming88/WGA-Raid-Hub/issues/868), [item catalog -> #1166](https://github.com/katogaming88/WGA-Raid-Hub/issues/1166).

---

## 2026-09-14 -- The wishlist is a BiS pick or a Pass, and only a BiS pick gets a priority number (#1032, #1033)

Shipped: not yet. Decision only; the change lands at cutover (#1105), with #935 retiring `bis_items` in the same arc.

`item_preferences.status` allows five values today: `bis`, `good` (2nd Choice), `ok` (Sidegrade), `catalyst` (Catalyst Only) and `pass`. `generate_priority_order()` ranks every non-pass row, with BiS picks first and the others behind them. Kat's call: only `bis` and `pass` remain, and a raider with no BiS pick on an item gets no number for it.

**Measured on prod before deciding (2026-09-14), active raiders on both teams.** The other three choices are heavily used: 1,137 rows (729 `good`, 348 `ok`, 60 `catalyst`) against 922 `bis`. Of the 256 items awarded since wishlists opened on 2026-08-07, 97 went to a raider who had marked it 2nd Choice, Sidegrade or Catalyst Only, and 98 to a BiS pick. No raid neck has a single BiS pick on either team, because raiders' BiS necks are crafted or from M+; Hellfire's Sentinel's Vitriolic Chain has 16 2nd Choice marks and went to Vellisara and Saucynuggz on them. After the change those drops have nobody on the list and officers award them by hand. Kat chose that knowingly over keeping a single "Upgrade" choice ranked behind every BiS pick.

- **It takes effect at cutover, not before.** The current site keeps ranking 2nd Choice and Sidegrade until the new app launches, so no raider's Priority List changes mid-season. The new app's wishlist offers only BiS and Pass from its first day. The `generate_priority_order()` change (the candidate union loses every status but `bis`, and the `wishlist_rank` and score-multiplier tiers go) ships with #1105.
- **Existing `good`, `ok` and `catalyst` rows are deleted at the switch**, and the status check narrows to `bis` and `pass`. Raiders re-mark as BiS anything they actually want. A Catalyst Only want becomes a BiS pick on the tier piece itself.
- **One BiS pick per slot, two for paired slots**: Trinket, Ring, and one-hand weapons (dual wield, see the dual-slot item BiS semantics). A crafted or M+ placeholder counts as the pick for its slot, so a raider whose BiS neck is crafted has no raid neck pick.
- Readers to audit before the switch: `build_rclc_export`, `bis_demand_vs_awards`, `wishlist_setup_status`, Contested Items, and the placeholder path in `generate_priority_order()`, which must keep ranking as it does.

[Wishlist -> #1032](https://github.com/katogaming88/WGA-Raid-Hub/issues/1032), [priority -> #1033](https://github.com/katogaming88/WGA-Raid-Hub/issues/1033), [bis_items retirement -> #935](https://github.com/katogaming88/WGA-Raid-Hub/issues/935).

---

## 2026-09-14 -- Heroic sale runs: guests are signups on a run, and prices are a guild list copied onto each sale (#1070, #1076)

Shipped: not yet. Decisions only; the tables arrive with #1073 (guest signup) in Revamp 2 and #1077 (buyers) in Revamp 3.

Kat's calls before Revamp 2, for the Heroic Sale Runs feature that launches with the rebuilt site. The sales team is a small core roster plus guests from other teams who help on specific runs.

**A guest is a signup on a run, not a roster row (#1070).** Aeglos stays on Phoenix's roster only; helping on one run creates a signup that references his own character (his Phoenix `players` row) and that run's event id (#1071), with a status of pending, approved or declined. The rejected alternative, a hidden guest row on the sales team's `players`, would reuse RSVPs as they are, but give one character two roster rows and make every roster, loot and priority read remember to skip guests. The signup shape is also what #942's people table extends: one person, active on more than one team's data, the same case as #486.

- A run's roster is the core roster plus its approved signups. Attendance for a run reads from that, not from `raid_rsvps`.
- Guests sign up per run. The core roster never signs up.
- Each signup stores the guest's per-boss Heroic parse results at signup time (#1074). How strict the bar is (hard gate, officer judgment, or gate with override) is still open and moved to #1074; it is a rule over that stored data, not a different shape.
- Which team is the sales team is not decided. Nothing names it: it is a team setting (see the no-guild-specific-names rule), so choosing it is setup.

**Prices are a guild price list, copied onto each sale (#1076).** The same snapshot pattern as `boe_items`' payout floor and pivot: a sale copies the list price when it is recorded and can be adjusted, and a later list change never rewrites a past sale.

- **Type and price live on the buyer's record (#1077), not on the run.** Whether one run sells more than one type is "probably yes" and unconfirmed; per-buyer covers both answers.
- **A run carries a display-only list of the types it is selling**, shown on the calendar. Prices never appear there.
- **The sales team's officers and leader manage the price list, buyers and sales**, plus site admins. No new grant, and not `boe_managers`.

[Roster model -> #1070](https://github.com/katogaming88/WGA-Raid-Hub/issues/1070), [pricing -> #1076](https://github.com/katogaming88/WGA-Raid-Hub/issues/1076), milestone Heroic Sale Runs.

---

## 2026-09-14 -- tier_token_map carries a season code, and a season with no tier tokens is said out loud (#1108)

Shipped: `20260914113413_tier_token_map_season.sql`

`tier_token_map` had no season, so every row was implicitly Midnight Season 2's. The issue named the obvious cost (a re-seed replaces last season's mapping and nothing warns while it is missing). Re-auditing the readers found a worse one: the site's tier-piece counter, `classTierResolvedItemsBySlot()`, inverts the whole table into one resolved piece per class per slot. With a second tier seeded next to the first, it keeps whichever row it meets last, so a raider's equipped gear gets checked against the wrong tier, and that count is what `generate_priority_order()` weights tier-token drops by.

**The column holds the season code (`MID2`), not the display name.** It is the form `priority_order`, `rclc_loot` and `scoring` use, the form `generate_priority_order()` is called with, and the key #932's `seasons` table is planned around, so #932 adds the foreign key without converting a value. This went ahead of #931's inventory, which #1155 lists first, because this is the one question #1108 needed from it and #932 had already answered it.

- **Required, no default.** A seeding run that leaves the season out fails on insert rather than filing a new tier under no season. `scripts/generate-tier-token-map-sql.js` now stamps it from a `SEASON` constant changed with the token names.
- **Key is `(season, token_item_id, class)`.** The global uniqueness on `resolved_item_id` stays: each tier's class pieces are new items.
- **`generate_priority_order()` matches the season it is generating** in both of its lookups. Token ids are new each tier, so this changes no result on today's data; it keeps a regenerated archived season on its own tokens.

**The site keeps every season's rows for display and counts one.** The Wishlist and BiS grid still substitute resolved pieces from all seasons (token names differ per tier, and a past season's rows still need their names). The tier-piece counter reads only the season being generated: Season View, else the team's season, the same one the Priority tab passes to the function.

**"Fails loudly" became a warning and a refusal, not an error.** Raising inside `generate_priority_order()` would stop priority for every item, not just tier tokens, the moment a tier launched ahead of its seed. Instead:

- The Priority tab shows "No tier tokens are set up for Midnight Season N" when the season being generated has no rows, and a distinct "could not check" when the read failed, so a network error is not reported as a missing seed.
- **Sync Roster Tier Counts refuses to run** in either case. Before this it would have counted 0 pieces for everyone and written that over each raider's last real count.

[Full discussion -> #1108](https://github.com/katogaming88/WGA-Raid-Hub/issues/1108), Season milestone.

---

## 2026-09-14 -- the new app signs in with Battle.net, and Discord is linked to the same account (#1101)

Shipped: not yet. Lands with #1101 part 3 (sign-in) and #942 (people table); the hosted setup and the current site's Connect Battle.net button are #1157.

Kat's call while #1101 part 3 was being built: the new app's sign-in button is Battle.net, not Discord. It is the direction discussion #689 set out, taken one step at a time: Battle.net becomes how a person signs in and proves which characters are theirs, while Discord stays attached to the same account, because every grant (`team_members`, `site_admins`, `guild_officers`, `boe_managers`), the bot and the Discord notifications are keyed on a Discord id today.

**One auth account, two identities on it.** A person is one `auth.users` row carrying a `custom:battlenet` identity and a `discord` identity, joined with Supabase's manual identity linking. Nothing new in `public` is needed to hold the pair. #942's people table sits on top of that account rather than on either id.

**Characters come from Blizzard, not from a dropdown.** The Battle.net login token reads the account's character list (`/profile/user/wow`), which replaces the claim-your-character prompt and finds alts (#631, #486) without anyone picking them. The list is read by an Edge Function, never trusted from the browser, and the function checks that the token's Battle.net account id is the identity actually linked to the caller: a refused link still hands the browser a working Battle.net token, so holding one proves nothing about the account.

**Verified on the local stack before deciding (2026-09-14).** Battle.net sign-in creates an account with no email and the BattleTag on the identity; the token returned 47 characters across three WoW accounts; Discord-first then Connect Battle.net, and Battle.net-first then Connect Discord, both give one account with both identities, and either button opens it afterwards. A login already attached to a different account is refused ("Identity is already linked to another user"), so there is no takeover by linking.

**The link trigger already covers the new order.** Since #1135 `link_auth_user_to_member()` fires on `auth.identities`, so connecting Discord to a Battle.net account links that person's pre-listed grants the same way a Discord sign-up does. No schema change for that.

**Existing raiders are the one hard case, handled twice.** Everyone on the live site already has a Discord account. If they press Battle.net first they get a second, empty account, and connecting Discord to it is refused, because Supabase cannot merge accounts. So:

- The current site gets a Connect Battle.net button (#1157), where everyone is already signed in with Discord, so most accounts carry both identities before the January cutover (#1105).
- The new app notices a Battle.net sign-in that landed on a brand-new account with nothing attached, offers "Sign in with Discord instead", removes the empty account, and connects Battle.net to the real one.

**Provider setup, recorded because both were found the hard way.** The provider is `custom:battlenet` of type `oauth2` (authorize, token and userinfo at `oauth.battle.net`), not `oidc`: Blizzard publishes its signing key in standard base64 and GoTrue's key parser refuses it. Custom providers live in the auth database, created through the admin API with the `custom:` prefix included, so they are not in `config.toml` and a local `supabase db reset` can lose one. The hosted project also needs manual linking switched on.

[Discussion -> #689](https://github.com/katogaming88/WGA-Raid-Hub/discussions/689), [people table -> #942](https://github.com/katogaming88/WGA-Raid-Hub/issues/942), part of #1101.

---

## 2026-09-13 -- identity is the auth.identities row, not the metadata copy (#1135)

Shipped: `20260913215858_identity_from_auth_identities.sql`, `20260913220137_link_trigger_on_auth_identities.sql`

The third and last piece of the #947 escalation arc, and the one that removes the cause rather than a route to it. #1117 stopped `claim_character()` taking over a linked row and #1118 stopped the link trigger firing for a non-Discord signup. Both are guards on a read that should not have been happening.

GoTrue writes a Discord account's snowflake into two places at sign-in: `auth.identities.provider_id`, which only the provider writes, and `auth.users.raw_user_meta_data ->> 'provider_id'`, which the account itself can rewrite through `PUT /auth/v1/user`. Two records of one fact, one of them forgeable, and the schema read the forgeable one in seven places.

**The decision is that there is one answer to who an account is, and it is the identity row.** `current_discord_id()` reads it, a new `auth_user_for_discord_id()` does the reverse for the four grant RPCs, and nothing else in the schema names the provider string. The metadata copy cannot be deleted, because GoTrue keeps writing it, so it is demoted instead: it is display residue, and T5 in `tests/rls/function-invariants.test.js` plus `tests/ci/functions-identity-source.test.js` refuse a new reader on either side.

**The link trigger moved rather than being guarded again.** It fired `after insert on auth.users`, where the identity row does not exist yet: GoTrue inserts the account first and the identity after it, in the same transaction. That ordering is why #1118's guard had to go through `raw_app_meta_data` instead of the thing it actually wanted. On `auth.identities` the trigger reads the row it fired on, `new.provider` and `new.provider_id` and `new.user_id`, and the question disappears. It is also the shape #942's people table wants, where a verified external identity appearing is what attaches a person to their grants.

Three consequences worth recording:

- **The grant RPCs dropped their `limit 1`.** `identities_provider_id_provider_unique` on `(provider_id, provider)` makes the reverse lookup exact, where `auth.users` gave no such guarantee and an arbitrary row was being taken. `current_discord_id()` has no `limit 1` either, but for the opposite reason: one identity per provider per user is GoTrue's rule enforced at its API rather than a constraint here, so a limit would paper over a state worth seeing.
- **The local seed moved to Discord identities.** It wrote `provider = 'email'`, so every persona would have resolved to nobody. Production has one discord identity per account and no email identity anywhere, and the seed now matches. It costs the local login nothing: `dev:login` signs in by admin magic link, GoTrue looks that up by `auth.users.email`, and verifying one against a discord-only account adds no email identity (checked on the pinned local stack).
- **Nothing changed for any existing account.** Measured on production before shipping: 73 accounts, 73 identity rows, all discord, none missing, no duplicate `provider_id`, and zero accounts whose metadata disagreed with their identity row. No backfill, and no answer changes.

Deliberately left alone: `resolve_actor_name()` and `resolve_discord_display_name()` read `full_name` and `name` out of the same metadata for display. A forged display name is cosmetic, not an escalation. Renaming the Discord-shaped vocabulary, and re-keying `boe_items.finder_discord_id` onto the account, belong to #942 and #659.

---

## 2026-09-13 -- access rules read roles once per query, not from the login token (#1106)

Shipped: `20260913215012_rls_helpers_once_per_query.sql`

#1106 proposed a custom access token hook that writes each person's roles into their login token, so rules compare a token value instead of querying `team_members`. Its first step was a benchmark, run on the previous night's production backup as a signed-in officer ([results on #1106](https://github.com/katogaming88/WGA-Raid-Hub/issues/1106#issuecomment-5657881723)).

- **The cost was per-row helper calls, not role lookups as such.** `my_team_role(team_id)` and `is_own_player(player_id)` take a per-row argument, so Postgres runs their query once for every row: 127 ms to read Phoenix's wishlists against 4 ms with the rules skipped, 45 against 2 for the audit log. Reads whose rules used no such call were already within a couple of milliseconds of skipped.
- **Chosen: array helpers evaluated once per statement.** `my_officer_team_ids()`, `my_leader_team_ids()` and `my_active_player_ids()` return the caller's ids, and rules compare `team_id = ANY ((SELECT my_officer_team_ids())::integer[])`. The scalar subquery has no row reference, so it becomes an InitPlan. The argument-free helpers are wrapped `(SELECT ...)` for the same reason. After: every benchmarked officer read is within about half a millisecond of the rules-skipped time.
- **Rejected: the login-token hook.** It cannot beat "rules skipped", which the rewrite already reaches, and it brings a stale-role window: a removed officer keeps access until their token refreshes (an hour by default), which #1106 would have needed a live check on sensitive writes to contain. It also needed enabling on the hosted project.
- **Rewritten mechanically.** The 54 rule expressions were generated from `pg_policies` by substituting exactly those patterns. Verified by row-set equality: every seeded account and anon, against every public table, sees the identical rows before and after (782 combinations), and the full RLS write suite passes unchanged.
- **Kept honest by a test.** `rule-helpers-once-per-query.test.js` fails when any rule calls a function other than a wrapped, argument-free helper, so a new rule in the old shape is caught in CI rather than by the next timeout.
- **Semantics note:** `my_team_role()` picked an arbitrary row if an account had two memberships on one team; the array form counts any officer row. Nothing enforces one membership per account per team, but production has none.

## 2026-09-13 -- only a Discord signup links a grant row (#1118)

Shipped: `20260913192229_link_trigger_requires_discord_provider.sql`

The other half of #1117, and the same root cause. `link_auth_user_to_member()` fires `after insert on auth.users` and fills `auth_user_id` on any unlinked row in `team_members`, `site_admins`, `guild_officers` or `boe_managers` whose `discord_id` matches `new.raw_user_meta_data ->> 'provider_id'`. Whoever creates the account supplies that value, so the trigger handed out grants on an unverified claim: an email signup carrying somebody's Discord snowflake inherited their row and its role, with no character needed. Each update already carried `and auth_user_id is null`, so the exposure was bounded by the unlinked-grant census, one row on production.

- **One early return, not a fourth condition on each update.** Same semantics, and a fifth grant table added later is covered without anyone remembering to add the clause. `is distinct from` is what makes an account with no `raw_app_meta_data` return early instead of comparing against null.
- **Insert-only, deliberately.** Firing on update as well would have let the local dev tool stamp the provider after creation, but a repeat OAuth sign-in performs three updates (`UpdateOnly(identity)`, `UpdateUserMetaData`, `UpdateAppMetaDataProviders`), so the trigger would run on every sign-in and keep re-reading metadata that stays writable until #1119's successor retires it.
- **An `auth.identities` check is not available here.** The trigger fires before any identity row exists for the new user, which is also why this is a narrowing of the metadata read rather than the move to `auth.identities` that finishes the job.
- **`provider`, the scalar, not the `providers` array.** At insert an account has exactly one provider and the two agree. GoTrue rewrites `provider = providers[0]` when a second identity is linked later, which an insert trigger never sees.
- **Nothing on production changes.** All 73 accounts read `raw_app_meta_data ->> 'provider' = 'discord'` and none lacks an `auth.identities` row, measured the day this shipped.

The dev tool moved with it. `npm run dev:login -- --discord-id` used to be one `generate_link` call and leaned on this trigger to bind the grants. There is no way to reach the guard through the auth API: `adminUserCreate` stamps `provider: "email"` on the model, runs `tx.Create(user)`, and applies caller-supplied `app_metadata` only afterwards as an UPDATE, so the trigger sees `email` every time. Only a real OAuth signup stamps `discord` before the insert. The route now mints its `auth.users` and `auth.identities` rows by SQL, the way `seed.sql` and `snapshot-personas.js` already mint personas, and the guarded trigger links them.

## 2026-09-13 -- user metadata stops deciding who owns a team_members row (#1117)

Shipped: `20260913184623_claim_character_refuse_linked_row.sql`

`claim_character()` resolves a caller with no `auth_user_id` match by their Discord id, read from `auth.users.raw_user_meta_data ->> 'provider_id'`. That column is writable by the account it belongs to, so the caller chose which `team_members` row the fallback found, and the fallback relinked it without checking whether anyone already held it. A row with a role took its role along.

- **The guard is an unlinked check, not a removal of the fallback.** Adopting an unlinked row is the Discord Claims import path (#338) and the reason the fallback exists: a blind insert there violates `team_members_team_id_discord_id_key`. Only a row already linked to a different account is refused.
- **It refuses rather than falling through to the insert.** Falling through would hit that same unique constraint and surface a constraint name instead of the reason.
- **The check rides on the select that already runs**, taking `tm.auth_user_id` alongside the id and role, so there is no second read to go stale between the check and the write.
- **`raw_app_meta_data`, not `raw_user_meta_data`, is the trustworthy half** of an auth row: it is service-role-only and stamped by GoTrue. The repo's own Supabase skill says so at `.agents/skills/supabase/SKILL.md:37`, and the guard on `link_auth_user_to_member()` (#1118) uses it.
- **This does not retire metadata as an identity source.** The two BoE read policies, `submit_boe_found` and the four `admin_grant_*` RPCs still read the same column. Resolving identity from `auth.identities`, which only the provider writes, is the full fix and is tracked separately. Production helps here: all 73 accounts carry `raw_app_meta_data.provider = 'discord'`, none lacks an identities row, and no `provider_id` is duplicated.

This narrows an equivalence `docs/RLS.md` and this log had both recorded as intended, that the metadata claim and a Discord identity are the same fact. They hold the same value; only one of them is attested.

## 2026-09-13 -- a person keeps the link to their archived characters, and name_realm matches ignoring spaces and case (#941)

Shipped: `20260913182610_resolve_person_and_kept_character_links.sql`

Measured on production 2026-09-05 and again 2026-09-13 (unchanged). The identity question gets a function and an index, not a table; the people table is still #942.

- **The link stays on archive.** `add_signup_to_roster()` nulled `players.team_member_id` on the character a main swap retired, which is why none of the eight BoE finds pointing at an archived character could resolve a finder. It no longer does. Consequence accepted: one person can own several `players` rows on a team, only one of them active.
- **Every person-to-character reader filters archived rows.** `is_own_player()` was the one database reader without the filter; it gained it, so a raider's own-row rules never reach a retired character. On the client, the three embedded `players!players_team_member_id_fkey` reads (claim-elsewhere prompt, guild page team pick, roster cold landing) filter too, the same way `js/boe.js` already did. `admin_revoke_team_role()` now counts archived linked characters as claims, which is right: deleting that member would null the kept links.
- **Reviving a reused name hands the link to the signer.** If a signup's name matches an archived row still linked to a different member of that team, the link moves to the signing account's member. A signup with no account (19 of 76 on production) leaves the link alone, because a returning raider re-signing is far more common than a reused character name.
- **`name_realm_key`**: a stored generated column, `lower(replace(name_realm, ' ', ''))`, with a unique index per team. Case and spaces only, the same rule `import_rclc_loot()` already matched on; apostrophes and hyphens are left alone because nothing on production differs by them. The stored `name_realm` keeps its original spelling. The old exact `(team_id, name_realm)` constraint stays for the legacy import script's conflict target.
- **Duplicates merged, not left to fail the index.** Both groups on production were an archived officer-entered row plus an archived import stub carrying three `rclc_loot` rows. The merge keeps the active, then linked, then lowest-id row, moves the tables that cannot clash (`rclc_loot`, `boe_items`, `bis_requests`, `self_received_requests`, `season_signups`, and `audit_log` targets), and refuses to run if a merged-away row has anything in any other table.
- **The backfill links were named by Kat** (2026-09-13), not inferred: nothing recorded which member an archived character had. Fluphie -> Fluffyfistz, Razuvious -> Torbjorn, Xyorill -> Neldreth, Inquizical -> Soulcialist, Flamess -> Flamè, each linked to whoever holds the current character.
- **`resolve_person(discord_id)`** returns one jsonb value rather than rows, because the answer is nested (grants, teams, characters). Visibility follows the existing read rules: self, site admins and guild officers see every team; team officers see only teams they run; the `site_admin`/`guild_officer` flags are shown only to the person and site admins.
- **A generated column is invisible to BEFORE triggers.** `restrict_players_self_update_to_bonus_roll()` compares the whole row via `to_jsonb()`, and `name_realm_key` reads null in `NEW` there, so it now subtracts that column too. Any future generated column on a table with a whole-row guard needs the same.

## 2026-09-13 -- how guilds, URL keys and player codes are stored (#1114)

Shipped: `20260913180002_guild_url_keys.sql`

The schema half of the address decision below (#1100). Settled while building it:

- **Player codes are unique site-wide, not per team.** Simpler to look up, and it survives the code moving to `people` when #942 lands. A code is still looked up _under_ the team the address names, so a real code pasted under the wrong team is not found rather than silently redirected.
- **A player code never changes.** A trigger refuses any update to `players.url_code`, because officers can otherwise edit the whole row, and there is no retired-code table to catch a changed one. Nothing about a player (rename, realm move, main swap) needs a new code.
- **One lookup function, `resolve_address()`, rather than plain reads on three tables.** The app makes one call per navigation and gets back ids, each part's current key, and `is_canonical`. No row means not found; `is_canonical = false` means the address used a retired key or different letter case, so the app redirects. Security invoker, since every table it reads is already public, which is what lets a signed-out visitor open a shared link.
- **Retired keys are written by trigger on `guilds` and `teams`**, not by the admin functions, so a key changed from a migration or the service role is kept too. Changing a key back to one it used to have removes it from the retired list. A current key always wins over a retired one; among retired keys, the most recent wins.
- **No new write path for keys.** Guilds have no client write access at all, and team keys are already set only through the site-admin functions `admin_create_team()` and `admin_update_team()`, so "only a site admin can set a readable key" held without adding anything.
- **Key format**: lowercase letters, digits and single hyphens, 2 to 32 characters, as a CHECK on both tables. Random keys and codes are 8 characters from `[a-z0-9]`, from `pgcrypto`'s `gen_random_bytes`. A collision (odds about 1 in 2.8 trillion per pair) is not retried; the unique constraint turns it into an error.
- **Guild-wide grants stay unscoped for now.** `guild_officers`, `boe_managers` and `site_admins` get a guild when #942's `guild_grants` replaces them; nothing needs a second guild before then. `admin_create_team()` refuses to guess once a second guild exists, and #1045 adds the argument.
- **Still site-wide for now**, noted for #1045: `teams.name` is unique across all guilds, and a few current-site paths look a team up by slug alone (`?team=`, Edge Functions). Both are correct while there is one guild.

## 2026-09-13 -- one per-account preferences store instead of a table per flag (#940)

Shipped: `20260913162438_account_preferences.sql`

Russell's rule, decided 2026-09-05 on #940 and built now: a "don't show me this again" is a key in a per-account store, not a table of its own. `account_preferences` holds one row per (account, team, key), `team_id` null for guild-wide keys, and replaced `no_character_dismissals` (#512). It also took the notification bell's "cleared through" marker out of `localStorage`, where one inbox had two read-states and the browser's half was lost on a new device.

- **Rows per key, not one jsonb blob per account.** A shapeless blob is what `team_settings.config` drifted into; rows keep a `set_at` per key and keep the keys enumerable.
- **A CHECK names every allowed key** and pins which are guild-wide and which are per team, so adding a key is a migration rather than a typo.
- **The unique key is a real `unique nulls not distinct` constraint**, not an expression index on `coalesce(team_id, 0)`, because PostgREST's `on_conflict` takes column names and needs a matching constraint for the client's upserts.
- **Direct writes under an own-rows RLS rule, no RPC**, the same reasoning #512 gave: no cross-table validation, only "write one row for myself".
- **Claiming a character clears the dismissal, by trigger on `players`**, not by a line in each function, because several paths set the link (`claim_character()`, `add_signup_to_roster()`'s main swap, any future one). The old table was never cleared: 11 of its 12 rows on production belonged to accounts that had since claimed a character, and those rows were not carried over.
- **Deliberately not moved:** `streamers.guild_wide_opt_out` belongs to the person but has no data to migrate, so it moves when `streamers` is next touched; `wga_team`, `wga_open_profile` and the stream widget's collapse state are device state and stay in the browser.

When the people table lands (#942), `auth_user_id` becomes `person_id` and nothing else about the store changes.

## 2026-09-13 -- page addresses carry a guild key and a team key, readable for WGA and coded for everyone else (#1100)

The schema half shipped with #1114 (entry above); the app shell (#1101) routes on it. the full address map is on [#1100](https://github.com/katogaming88/WGA-Raid-Hub/issues/1100#issuecomment-5655852445).

The rebuilt site (#1109) routes every guild-scoped page as `/g/<guild key>/t/<team key>/...`, so WGA's Phoenix roster is `/g/wga/t/phoenix/roster`. Kat's call: WGA keeps readable names, and any other guild that uses the site later gets random codes (`/g/k3n9x2qa/t/p7q4m81z/roster`), the way WoWUtils addresses its groups. There is one route shape; the difference is only in what the key holds.

What that asks of the database:

- **A guild level exists.** A `guilds` row for WGA with key `wga`, and every team linked to it. Nothing models the guild today (guild-wide things like BoE sales and guild officers are simply not team-scoped), and #1045 and the people table in #942 both need it anyway, so the address decision is what brings it forward rather than a new cost.
- **Guilds and teams each carry one URL key.** Teams reuse `teams.slug` (`phoenix`, `hellfire`, `immolation`, `wrathless`). A new guild or team gets a random 8-character lowercase alphanumeric key by default, and only a site admin can replace it with a readable one, so no guild can claim a name like `wga`. Guild keys are unique site-wide, team keys unique within their guild.
- **Players are addressed by a code, never by `name_realm`.** A readable player address would break on a rename, a realm transfer, or a main swap, and `name_realm` is not even normalised today (#941 found `Area 52` and `Area52` forking one person into two rows). A code column on `players` avoids all of that and carries over to `people` when #942 lands.
- **A changed readable key keeps redirecting.** When a guild or team key is renamed, the old key is kept and resolves to the new one, so links already posted in Discord keep working.

Rejected: name-based addresses without a guild segment (`/phoenix/roster`), which read best for WGA today but would need every shared link redirected the day a second guild arrives, and team names can collide across guilds. Codes for WGA too, which would give up readability for WGA's own raiders to buy nothing the key-per-guild scheme does not already give.

## 2026-09-08 -- SQL injection posture: static SQL, pinned search paths, and grants that match production (#1009, #1010, #1011, #1020)

Shipped: `20260908155617_pin_search_path_on_invoker_functions.sql`, `20260908155859_revoke_anon_on_submit_season_signup.sql`, `20260908200838_submit_season_signup_restore_require_auth.sql`

A read-only spike (#1009) asked what stops SQL injection here and what enforces it. The answer to the first was structural and already sound: everything above the database reaches it through PostgREST, which binds filter values and RPC arguments, and below that every function body is static SQL with row-level security bounding anything that got past a filter. No path was found by which text from a raider, an officer, a Discord payload or an external API reaches SQL as SQL.

The answer to the second was nothing. The stance was held by review, so this entry records the four things that now hold it, all in `tests/rls/function-invariants.test.js`: no dynamic SQL in any body (with `rls_auto_enable` allowlisted, whose `format()` argument is DDL object identity), every function pinning its search path, set equality on which SECURITY DEFINER functions `anon` may execute, and `rls_auto_enable` being the only event-trigger function.

Two of those started red. Twelve SECURITY INVOKER functions had no pinned search path while all 59 definers had pinned theirs since July; three of the twelve resolve relations unqualified, which is why the pin was worth taking rather than tidy. It was never reachable: neither API role holds CREATE on the database or the schema, so neither can put a relation ahead of `public` on the path.

The grants half is the more interesting one, and it is why the revoke went into `supabase/roles.sql` rather than a migration. The local Postgres image grants EXECUTE on every new public function to `anon`, `authenticated` and `service_role`; production grants none of them. `roles.sql` is applied before any migration runs, so a default set there lands before the first function exists, where a migration would run last and align nothing. Postgres's built-in PUBLIC default is deliberately left alone, because a per-schema default is added on top of it and cannot remove it, so migrations keep their explicit `revoke ... from public`. That built-in default is the live one on production: the only thing keeping a new function off `anon` there is the author writing that revoke by hand, which 61 migrations do, and the set-equality test is what catches the first one that does not.

Supabase's own security linter is the fifth thing holding the line, and the only one written by somebody else (#1011). It runs on every migration PR against the schema the files build, with an allowlist naming the findings this project has accepted: the `incoming_roster` view #503 tracks, and three that describe the architecture rather than a defect (every submit path is a definer RPC `anon` may call, every write path one `authenticated` may call, and leaked-password protection is a toggle on a password sign-in this project does not have). The allowlist is deliberately fragile in one direction: an entry naming a specific object fails the run once that object is gone, so a fixed finding takes its entry with it and an empty report cannot pass as a clean schema. Worth knowing when reading a green run: `--local` and `--db-url` execute the CLI's embedded lint query, while `--linked` reads the Management API, and those three architectural findings exist only on the API side, so CI never sees them.

It caught one immediately, and the cause was not the one it looked like. `20260726104516_submit_season_signup_auth_user_id.sql` grants `anon` execute and was added 2026-07-15 in #505, one of five migrations in that PR stamped eleven days ahead of the commit that added them. `20260716210158_submit_season_signup_require_auth.sql` revokes `anon` and was added 2026-07-16 in #514, closing #513. So the file written first sorts second, and a replay ends on it. Neither header is wrong: the July 15 one says the function must stay callable by `anon` for recruits with no Discord session, which was true when it was written and was reversed the next day.

Production applied each migration when its PR merged, so it took them in the order they were written and still carries the July 16 definition. The divergence exists only where the schema is rebuilt from files, which is a `db reset`, a shadow database, a new contributor's machine and CI.

Every migration was checked for the same shape: 168 files, 39 database objects defined more than once, and this is the only one whose file order disagrees with the order its definitions were authored in. The class is closed going forward by the rule #927 added to the ledger check, which fails a file stamped ahead of the Eastern wall clock at the commit that added it. The second migration above closes the grant half, and the third closes the body half (#1020), reissuing the July 16 definition so a replay ends on the raise rather than on the opportunistic branch. Restoring the body was taken over renaming the July 15 file, which would sort correctly and is the worse fix: that timestamp is in production's applied ledger, so renaming it makes `supabase migration list` report a version production does not have, which is the state the 2026-08-31 repair existed to get out of. `tests/rls/submit-season-signup.test.js` is the function's first coverage and pins the refusal.

## 2026-09-06 -- the bot moves into this repo, and every poster follows one rule (#953)

Two decisions from the same spike, recorded together because the second is why the first was needed.

### One repo

`katogaming88/wga-raid-bot` becomes `bot/` here and is archived, the way `boe-found-bot` was. Both maintainers agreed.

The bot had already become a first-class part of the app: three site PRs in the week of 2026-09-01 (#914, #915, #920) each shipped with a bot PR on the other side. But milestones are per repo, so a change spanning the relay and a bot route was two PRs with a handshake nobody wrote down, and it happened three times that week. The two repos also sat at very different quality bars. This one carries sixteen workflows, thirty-seven labels, a changelog gate, a version stamp, a migration ledger check and 146 test files. The bot repo had no CI, no labels beyond GitHub's defaults, no README and no changelog, and Russell could not push to it at all.

The reason that outweighs the rest: one repo is the only shape under which "one project" is true by construction rather than by discipline. A milestone can hold bot work, a relay-and-route change is one PR, the site's gates cover the bot from day one, and both maintainers can build anywhere.

Nothing about the bot's runtime changes. It stays a discord.js gateway process on kat's Oracle VM under two pm2 processes behind Caddy, because that design needs a host that never exits: it holds a websocket to Discord's gateway, an inbound express port, a 15-minute timer and a local file for the nudge cooldown. None of those survive a request-scoped runtime. Deploying gains one `cd`.

The cost, accepted: GitHub Pages serves this repo from `main` at `/`, so `bot/src/*.ts` becomes fetchable. Untidy rather than unsafe, since the repo is public, `dist/` and `node_modules/` are ignored and no secret is committed. `.nojekyll` is not the answer and is ruled out separately, because #967 takes its build SHA from Jekyll.

The alternative was two repos under one umbrella: kat grants write access, the bot repo imports the labels, a template, a small CI and a changelog, and a project board spans both. It settles access and vocabulary and nothing else. Milestones stay per repo, every cross-repo change stays two PRs forever, two CI configs drift apart, and every item is re-audited twice. That cost is permanent and paid on exactly the work that is now most active.

### One posting rule

Every poster this project has, webhook or bot, whoever wrote it:

- A post says what the database holds, not what its caller sent it.
- Every send names its `allowed_mentions` explicitly.
- No post from this project notifies `@everyone` or `@here`.
- No route is reachable without a credential appropriate to its caller class.
- Where a post lands is declared in one place.

The Discord facts underneath, which are why this needs both a code half and a server half: with no `allowed_mentions` a webhook parses user mentions only, while a bot's regular message parses users, roles and `@everyone`; `parse` is exclusive with the `users` and `roles` lists; and a role mention notifies only if the role is `mentionable` or the sender holds `MENTION_EVERYONE`. So the code half is #959 and the server half is #963, and neither alone is the rule.

What prompted it: #926 moved the BoE found post off an embed onto plain content, and a mention inside an embed never notifies, so the guard that had been holding was an accident of the format rather than a decision. The audit that followed found the relay deployed with no JWT check and no auth gate of its own, which leaves all nine bot routes open to anyone with the URL, including DMs to arbitrary Discord ids.

Shipped: no migration. Convention and repo shape only; the move is #954 and the gate is #959.

---

## 2026-09-06 -- one product version line, and each piece carries the release that last touched it (#965)

The version was a frontend number wearing a product's name. `js/common.js` held `var VERSION` at 3.91.3 after 396 headings in 83 days, while `package.json` said `1.0.0` and was not a source, and there were no git tags and no GitHub Releases. Everything else the project ships moved without the number ever saying so: 162 migrations in two months, ten Edge Functions with no version constant anywhere in them, and a bot whose `package.json` had never been bumped. A `### Backend` entry had no number of its own and rode whichever version block it happened to land beside, which is also how three numbers (3.77.23, 3.60.32 and 3.60.6) each ended up used twice by a backend-only PR opening a second heading a day later.

Semantic Versioning's first rule requires a declared public API, so the question was never whether to keep semver but what the number is a promise about. `CONTRIBUTING.md` already declared one contract, for URLs, bookmarks, sessions and additive-only schema. Three more were being kept in people's heads: the schema and RPC surface the frontend and the bot both read, the HTTP shape of each Edge Function, and the relay's action map. Those three are why the schema, the functions and the bot had no number that could have meant anything.

Three shapes were available and the choice is between the second and the third:

- **Independent semver per piece** was rejected. Every one of these pieces has exactly one consumer and that consumer is inside this project, so rule 1 has no referent: a separate `1.4.2` for `boe-webhook` would inform nobody, while costing a version line, a changelog and a compatibility matrix per piece.
- **Calendar versioning** was rejected. Its criteria half fit, but 393 distinct versions, CI keyed on `x.y.z`, a news feed keyed on the version and a declared contract table all read the current format, and switching would be churn with no reader who benefits.
- **One product line, changed pieces taking the new number**, was chosen. This is the lockstep mechanism (one series, unchanged pieces keep the number of the last release that touched them), and it answers both "what version is the product" and "what version is this piece" without minting a second ledger. The documented cost is real and accepted: a breaking change in any one contract majors the whole product, which is correct here, because a broken contract breaks the product regardless of which piece holds it.

The pieces already had honest identities from their own platforms, and those stay: the migration ledger head for the schema, each function's deploy counter and bundle hash, the commit for anything built. The product version says which release something belongs to; the platform identity says which artifact is live. Recording both is what makes it possible to detect a function that was merged and never deployed, which nothing in this repo could do before.

Nothing is renumbered. A released number is never reissued and a released block is never rewritten, so the three collisions stay and carry a note; #966 adds the forward check that refuses the next one.

Rejected for now, with the condition that would revive each: PostgREST's schema-per-version with `Accept-Profile` (the docs frame it as multi-tenancy, and it becomes the right tool the day a breaking RPC change has to coexist with the old one for a caller nobody controls; until then the additive rule plus a temporary `fn_v2` beside `fn` is less machinery), and release automation driven by Conventional Commits (the hand stamp works and is not the bottleneck, and it would impose a commit convention on both maintainers).

The repo-neutral reasoning, with its sources graded, is the `versioning-whole-and-parts` knowledge-base entry in claude-config. This entry is the application to this database and this repo.

Shipped: no migration. Convention only; `app_version()` is #969.

---

## 2026-09-05 -- players' officer-only columns move to a side table rather than a revoke or a view (#925)

`players` carries a `Public read players` policy with `qual = true`, `anon` and `authenticated` both hold table-level SELECT, and no column ACL narrows either. Three officer-written columns rode along with the public roster read: `officer_notes`, `archived_reason` and `archived_reason_detail`. Measured against prod on 2026-09-05, an anon read with the publishable key alone returned officer notes on three players and removal reasons on two. That policy's `polroles` is PUBLIC rather than a role list, so every signed-in raider read them too, which is the wider half of the exposure and was not in the issue as filed.

Three mechanisms were considered and two were rejected on structure, not preference:

- **A column revoke alone** cannot work while the shared roster select names the columns. One query at `js/common.js` serves `index.html` signed out and `officer.html` signed in, so revoking breaks the public roster. A column grant cannot separate the two audiences either: officers and raiders both hold `authenticated`, and the split this data needs is per row (am I an officer of this team) while column privileges are per role. No migration in this repo has ever used one.
- **A view** is no help for the same reason the six existing views over `players` are harmless: all six are `security_invoker`, so the base table's RLS applies as the caller and nothing is narrowed. The only view shape that would be a boundary is a definer-rights view, which is exactly what #503 is open to remove from `incoming_roster`. Adding one would move against that.
- **A side table** was chosen. `player_officer_notes` holds the three columns behind an officer-scoped policy admitting the same people the columns were reachable by before: team officers and team leaders on that team, guild officers, site admins. Once the columns are off `players` the public read policy stops applying to them at all, and no later edit to the public select can reintroduce the exposure by naming a column that is not there.

A SECURITY DEFINER read function (#503's idiom) was the near miss. It solves the read for officers but leaves the columns on `players`, so it still needs a column revoke from both `anon` and `authenticated` to close the exposure, which is the mechanism with no precedent here. The side table needs no such companion.

`m_plus_note` deliberately stayed on `players`. It is officer-written but not officer-only: `renderProfile()` shows it on the public profile beside the Excluded badge, so moving it would have blanked a public element. It holds no rows and #945 lists it as a prune candidate.

`archive_player()` came with the move. `archived_at` stays on `players` while the reason moves, so removing a raider now spans two tables; two client writes would leave a window where someone is archived and the reason never landed. The function is SECURITY INVOKER, so both writes pass the caller's own policies, and it refuses a second archive so a double click cannot overwrite the first reason. Its upsert touches only the two archive columns, so removing a player who already has an officer note keeps that note.

Shipped: `supabase/migrations/20260905154234_player_officer_notes.sql`.

---

## 2026-09-04 -- Aggregated Discord signup sheet: the bot owns all the logic, not a new Edge Function

Tracking issue: [#900](https://github.com/katogaming88/WGA-Raid-Hub/issues/900), part of #640.

- **All the roster/RSVP querying, role grouping, embed building, and message-ID bookkeeping lives in the bot** (`wga-raid-bot/src/signupSheet.ts`), using the bot's own service-role Supabase client (same precedent as `wishlistStatus.ts`'s `fetchNudgeCandidates()`, already used by `/nudge-missing`) -- not split between a new site-side Edge Function and the bot. Reason: the Refresh button and the proactive lead-time sweep both need the bot to independently rebuild the exact same embed without any site-triggered event, so the formatting logic has to exist bot-side regardless -- splitting it would mean maintaining the same grouping logic in two places. The site's role shrinks to a migration for the DB objects the bot depends on, one new `discord-bot-webhook` relay action per bot capability, and the officer-facing settings.
- **Two new service-role-only functions**, `raid_night_info()` and `claim_raid_signup_sheet()`, granted to `service_role` with no explicit `revoke` from `anon`/`public` -- this mirrors `wishlist_setup_status()`'s existing grant shape (wga-raid-bot#8) rather than inventing a stricter pattern: neither function is `SECURITY DEFINER`, so RLS on the underlying tables (`raid_signup_sheets` has no policy for anyone but the service role) is the real gate regardless of who can technically call the function.
- **`claim_raid_signup_sheet()`'s atomicity is a `select ... for update` row lock, not a full claim/lease protocol.** A rare remaining race (two truly-simultaneous first-ever calls for a brand-new date, both missing the lock because neither row exists yet) is caught as a `unique_violation` and falls through to a re-select rather than being engineered away -- worst case is one extra duplicate message on a date's very first activity, never repeating, since only one `message_id` ever survives in the row afterward. Matches this codebase's established tolerance for similar low-frequency, self-healing races (#895's reminder-dedup-after-relay-succeeds ordering).
- **The channel ID needs a "Verify" step, not just a text input.** Most of WGA's Discord channels are named near-identically across teams (`phoenix-raid-attendance` vs `hellfire-raid-attendance`), so a raw numeric ID gives an officer no way to confirm they copied the right team's channel. `discord-bot-webhook`'s relay was changed to forward the bot's actual response body (previously discarded on every success) so a new `verifyChannel` action can show the resolved channel name back in the officer UI -- backward compatible, every existing caller is fire-and-forget and already ignores the extra fields.
- **Proactive lead time is officer-configurable, not a fixed cron offset.** Default 48 hours before the raid's actual start time (not "2 calendar days" by date alone) -- a Tuesday 9pm ET raid posts the preceding Sunday at 9pm ET. Lives in `team_settings.config.signupSheetLeadHours`, same team-leader/site-admin-only `set_team_setting()` path as every other flat settings key, no new RPC.
- **Bench players get their own section regardless of RSVP status**, diverging from the issue's original "every non-bench roster member" text -- Kat's explicit correction: an optional night is exactly the kind of night a bench player might get pulled in for, so they need to be visible on the sheet too, not silently excluded.

[Full discussion -> #900](https://github.com/katogaming88/WGA-Raid-Hub/issues/900)

---

## 2026-09-04 -- Optional raid nights: bench included, reminder dedup gets its own locked table

Tracking issue: [#895](https://github.com/katogaming88/WGA-Raid-Hub/issues/895), Phase 4 of 4 for the raid calendar (part of #640).

- **Bench players are not excluded from an optional night.** On a normal raid night, bench has nothing to RSVP about -- there's no default-Present for them to override, so `set_own_rsvp()` blocked them outright. Kat's correction while scoping this phase: an optional night (e.g. a bonus clear) is exactly the kind of night a bench player might get pulled in for, so treating bench the same as a mandatory night would silently exclude players who could actually attend. `set_own_rsvp()`'s bench guard now only applies when the target night is _not_ optional; the reminder sweep's roster query (`optional-rsvp-reminders`) deliberately has no `is_bench=false` filter, unlike every other roster query in this schema.
- **A shared `is_optional_raid_night(team_id, raid_date)` SQL function, not two copies of the precedence.** Both `set_own_rsvp()`'s server-side gate on the `Attending` status/bench exception, and the Edge Function's date-window scan, need to agree on exactly what counts as an optional night (cancelled exception wins > added exception wins > active recurring rule > not a raid night at all). Rather than port `js/calendar.js`'s `computeRaidNights()` precedence into both SQL and the Edge Function's TypeScript separately -- and risk the two drifting -- it's one `STABLE` SQL function, called from both.
- **`raid_rsvp_reminders_sent` gets RLS enabled with no read policy for anyone but the service role and `claude_readers`** (not even officer-read, unlike `audit_log`). It's a pure dedup log for the 24h/2h DM sweep, not an audit trail of a real action someone took -- a checkpoint row is meaningless without cross-referencing `raid_rsvps`/`raid_schedule` anyway, and there's no officer workflow that needs to see it. A service-role query in the SQL Editor is enough if it ever needs debugging.
- **The dedup insert happens after the bot-relay call succeeds, not before.** A crashed/timed-out relay call legitimately retries on the next 15-minute cron tick rather than being falsely marked sent -- same fire-and-forget tolerance already accepted by `_notifyRsvpBot`'s own RSVP-change notification. The accepted tradeoff is a rare double-DM if the relay succeeds but the dedup insert itself fails.

[Full discussion -> #895](https://github.com/katogaming88/WGA-Raid-Hub/issues/895)

---

## 2026-09-04 -- Per-team roles get a grant RPC, like the guild-wide tiers

Tracking issue: [#910](https://github.com/katogaming88/WGA-Raid-Hub/issues/910), part of the BoE Tracker milestone.

- **The per-team tier was the only grant tier with no RPC.** `site_admins`, `boe_managers` and `guild_officers` each have an `admin_{list,grant,revoke}_*` trio that resolves `auth_user_id` at grant time. `team_members` had none: the only writer was `claim_character()`, which requires a claimable character on that team, and the officer dashboard's promote is a bare role update on a character that is already claimed. So the role needed membership and membership needed a roster, which meant **a team with no players could not be given an officer through any path in the site.** Wrathless (team 4) is that team.
- **`claim_character()` was never the officer path, and making it one was rejected.** Claiming is a raider proving which character is theirs; a role is a grant. Relaxing the claim to mint membership rows would put the two on the same code path and give anyone who can claim a way to appear on a team's member list.
- **Grant refuses to change a role that is already set.** `role` drives `my_team_role()`, `can_settle_boe()`, `is_any_team_officer()`, `is_team_leader_anywhere()` and the read rules built on them. An upsert whose conflict branch wrote `role` would let one mistyped Discord id demote a sitting team leader, with the audit entry reading like a fresh grant and nothing anywhere reading as an error. Changing a role stays with the promote path. The one repeat case that writes is filling an `auth_user_id` that was never linked, which is logged as a relink rather than a grant.
- **Revoke demotes rather than deletes whenever a character is claimed.** `players_team_member_id_fkey` is `ON DELETE SET NULL`, so removing a member a character points at would silently unclaim that character: no error, no audit entry, and the person's own data quietly detached. A memberless row is deleted as normal.
- **Only a site admin can open a rosterless team**, and that falls out of the gate rather than being a special case: the gate is `is_site_admin() or my_team_role(team_id) = 'team_leader'`, and `my_team_role()` is null for everybody on a team with no members. Corrected 2026-09-14 by #752: that null passed the gate rather than closing it, the gate now coalesces it to false, and the statement holds because nobody holds a row on a rosterless team.
- **The identity refactor was considered and deferred.** The four grant tables each carry `(discord_id, auth_user_id)`: one person, unnamed, stored four times with four linkers. A `people` plus `team_memberships` model would collapse that and remove the unenforced duplication between `players.team_id` and its member's `team_id`. Against one dead row and one leader needing a second team, it is four to six PRs ending in a column drop on live prod with no rollback. Revisit only if Wrathless gains a roster.
- **`link_auth_user_to_member()` gained its missing fourth branch.** It has covered `team_members`, `site_admins` and `boe_managers` since #766 and never `guild_officers`, so a guild officer granted before their first sign-in stayed unlinked. Both current holders signed in first, which is why nobody hit it.

[Full discussion -> #910](https://github.com/katogaming88/WGA-Raid-Hub/issues/910)

---

## 2026-09-03 -- The finder's Discord id is stamped at submit, never client-supplied

Tracking issue: [#889](https://github.com/katogaming88/WGA-Raid-Hub/issues/889), part of the BoE Tracker milestone.

`submit_boe_found()` never read `auth.uid()`: the finder was the typed name, `player_id` resolved only on an exact match with an unarchived roster character on the chosen team, and the raider read policy was `is_own_player(player_id)` alone. On prod 24 of 67 rows carried a `player_id` and 16 of those reached a signed-in member; the other 43 were a typed name and nothing else, every Immolation and Wrathless row among them, since those teams have no roster. A raider who signs in should see the BoEs they reported, on every team, whatever they typed.

The row now carries `finder_discord_id`, stamped inside the RPC from the caller's auth row through a new `current_discord_id()` helper (the same `raw_user_meta_data ->> 'provider_id'` claim that `claim_character()` and the admin grant trios read), null for a signed-out submit. It is never client-supplied: the RPC's arguments are unchanged and the transition trigger's plain-UPDATE list does not include the column, so only the RPC and the one-time backfill write it. The raider read on `boe_items` becomes own player or own Discord id, both sides guarded non-null so a signed-out find never matches an account with none, and `boe_listings` gains the matching read through its parent row (it had no raider read at all, which would have shown a raider's listed find with a blank Listings cell once the page opens to raiders). The 16 rows whose player reached a member were backfilled from `team_members.discord_id`, the string `link_auth_user_to_member()` equates with the provider id at first sign-in.

Out of scope, per the issue: a raider claiming historical rows (asserting that a typed name was theirs is the same attribution problem the typed name already has) and a manager setting the id by hand (a hand-typed 18-digit id is a typo waiting to attach someone else to a payout). Accepted limit: a find reported signed out stays visible to the team's officers and the BoE managers only; the raiders of the teams that never sign in are in that case by design, and the page (#890) says so.

[Full discussion -> #889](https://github.com/katogaming88/WGA-Raid-Hub/issues/889)

---

## 2026-09-03 -- Raid Schedule admin tab writes directly under Phase 1's existing RLS, no new migration

Tracking issue: [katogaming88/WGA-Raid-Hub#894](https://github.com/katogaming88/WGA-Raid-Hub/issues/894), part of #640.

Phase 3 (the officer Raid Schedule tab) needed no migration at all -- Phase 1's `raid_schedule`/`raid_schedule_exceptions` migration already shipped the officer-write RLS policies up front specifically so this wouldn't need a follow-up. `js/tabs/tab-schedule.js` writes with plain authenticated `.insert()`/`.update()`/`.delete()` calls, matching `updateRosterFieldSupabase()`'s convention (`js/tabs/tab-roster.js`) rather than adding RPC wrappers -- this is officer config-table editing, the same shape as the rest of officer tooling (Season Settings, Roster field edits), unlike `raid_rsvps`' own-row RPC below, which exists specifically because a raider's own RSVP has no officer-write path at all.

A cancelled or removed night leaves any `raid_rsvps` rows already submitted for that date in place -- there is no cleanup job for them in v1. This is an accepted gap: those rows become harmless (nothing renders them once the night they're attached to no longer computes), and notifying affected raiders is out of scope until it becomes a real pain point.

[Full discussion -> #640](https://github.com/katogaming88/WGA-Raid-Hub/issues/640)

---

## 2026-09-03 -- raid_rsvps has no public or officer write policy at all

Tracking issue: [katogaming88/WGA-Raid-Hub#893](https://github.com/katogaming88/WGA-Raid-Hub/issues/893), part of #640.

Every write onto `raid_rsvps` goes through `set_own_rsvp()` (SECURITY DEFINER) -- there is no INSERT/UPDATE/DELETE RLS policy, not even for officers. This follows the `self_received_requests` precedent (that table also has no direct INSERT policy for anyone) rather than the more common officer-write-policy shape (`attendance`, `raid_schedule`): a raider's own RSVP is a first-person statement, not something an officer should be able to silently rewrite in a raider's voice. If an officer ever needs a correction path, that should be its own explicitly-named function/action later, not a blanket write grant.

`set_own_rsvp()` also deliberately does not take a `player_id` parameter -- it resolves the caller's own row itself, from `auth.uid()`, inside the same statement it writes with. Every other "own row" RPC in this schema (`update_own_signup()`, `claim_character()`) instead takes some identifying parameter and races a lookup against the write's own `WHERE` clause (the TOCTOU-safe idiom documented on those functions). That pattern exists because those functions are correcting/claiming an _existing_ row that already has an id to look up; an RSVP has no id to be handed in the first place; the caller is only ever asserting "my status, for this date," so deriving `player_id` fresh removes the race entirely instead of just closing it.

[Full discussion -> #640](https://github.com/katogaming88/WGA-Raid-Hub/issues/640)

---

## 2026-09-03 -- Team officers settle BoE payouts for their own team

Tracking issue: [#888](https://github.com/katogaming88/WGA-Raid-Hub/issues/888). Every BoE lifecycle RPC gated on `is_boe_manager() or is_site_admin()`, so a team officer read their team's rows and could act on none of them, while in practice a team's officers are who hand the finder their cut, and Immolation and Wrathless raid with the guild without otherwise using the site.

- **Native, by role, payout only.** `can_settle_boe(team_id)` is `is_boe_manager() or is_site_admin() or my_team_role(team_id) in ('officer', 'team_leader')`: the same authority the read policy already trusts, no new table, flag or admin surface. It gates `boe_mark_paid` and the paid-to-sold edge of `boe_revert`, so an officer marks a payout paid or donated and can undo that one step. Listing, sale, retire, edit and delete stay with managers and site admins.
- **Two shapes rejected** (Russell, 2026-09-03). A per-team switch (`features.boeOfficers`, default off) inverts the flag convention, leaves officers looking at rows with no buttons until someone flips it, and Wrathless has no Admin tab to flip it from. A per-team grant list (`boe_managers.team_id`) reverses #766's guild-wide reshape and duplicates `team_members.role` for exactly the people who would receive it. Both put their cost on the teams with the least admin surface.
- **No officer rows for Immolation or Wrathless in this change.** Immolation has a leader and an officer row already; Wrathless has none and its raiders report by typed name without signing in. A row assigns someone work, so it waits for an officer to ask; the setup guide's hand-insert section carries the recipe, and an admin surface for it gets an issue only on a second ask.
- The buttons arrive with #890, which opens the BoE page to every signed-in raider; this change is the migration and its tests, with no visible effect until then.

[Full discussion -> #888](https://github.com/katogaming88/WGA-Raid-Hub/issues/888)

---

## 2026-09-03 -- Raid calendar RSVP intent stays fully separate from the attendance table

Tracking issue: [katogaming88/WGA-Raid-Hub#640](https://github.com/katogaming88/WGA-Raid-Hub/issues/640) (phased into #892-#895).

`raid_schedule`/`raid_schedule_exceptions` (#892) are new tables for the calendar's recurring weekly raid-night rule plus one-off cancel/add exceptions. **Decision: raid nights are computed on the fly from these two tables for a requested date range, not materialized as per-instance rows.** A recurring rule needs no per-instance row until something is attached to a specific date (an exception, or an RSVP in #893) -- materializing "the next N months of nights" today would need a cron job to keep extending the horizon and a cleanup story for old rows, both avoided by computing instances client-side instead.

**Decision, stated directly by Kat and worth being explicit about:** the forthcoming `raid_rsvps` table (#893, self-mark Late/Leaving Early/Tentative/Absent) is forward-looking self-declared _intent_, captured before a raid happens. It is never synced into, or treated as a substitute for, the existing `attendance` table -- that table stays the sole retrospective record (populated from WCL log pulls or officer entry after the raid) and the sole input to the loot-fairness scoring pipeline. Someone can RSVP "Present" and still no-show; only `attendance` says what actually happened. This was raised explicitly because the two tables look similar (both are per-player, per-raid-night status) and the risk was a future contributor assuming one derives from the other.

A raid night can additionally be flagged `is_optional` (#895): on those nights there is no automatic default-Present, every non-bench raider must explicitly respond, and unresponsive raiders get a direct-message reminder from the Discord bot at 24h and again at 2h before raid time.

[Full discussion -> #640](https://github.com/katogaming88/WGA-Raid-Hub/issues/640)

---

## 2026-09-03 -- The auction house fee comes off the top; the finder is capped at the net

Tracking issue: [katogaming88/WGA-Raid-Hub#861](https://github.com/katogaming88/WGA-Raid-Hub/issues/861). Record Sale wrote `guild_cut = sale_price - finder_payout`, so every guild cut overstated what the bank receives by the game's 5% auction house fee (about 491,000 gold over last season's sales). The 2026-08-25 entry below chose to leave the fee unmodeled; this supersedes that bullet.

- **`boe_items.ah_fee`**, the fee the game kept, set by `boe_record_sale` and nulled by `boe_revert` with the rest of the receipt. `guild_cut` is now `sale_price - ah_fee - finder_payout`, and `boe_items_money_sums` enforces `finder_payout + guild_cut + ah_fee = sale_price` on every sold or paid row: the invariant this change creates, and the one that would have caught the gap.
- **The fee is the game's fixed 5% and not a setting** (Russell, 2026-09-03). No `site_settings` column, no admin field, no third argument on `set_boe_payout_settings`, though the issue had all three: one named constant in `boe_record_sale` and the same literal in the backfill. Checked against two real mails: a 125,000 sale with a 6,250 cut (prod row 24) and a 47,999 sale with a cut of 2,399 gold 95 silver (row 27). Silver and copper are ignored by decision, so the fee is `round(sale * 5 / 100)`, half away from zero, the payout's own rounding. The deposit the game refunds on a sold auction nets to zero and is not modeled.
- **The finder is capped at the net, not the gross** (Russell, 2026-09-03): `finder_payout = least(sale - fee, greatest(floor, round(sale * floor / pivot)))`, so on a sub-floor sale the guild takes zero rather than going out of pocket by the fee. Every payout above the floor is unchanged. Two prod rows moved: ids 2 and 25, both sub-floor sales with a guild cut of 0.
- **The backfill corrects every row sold before the fee existed**, the 48 imported from the sheets included, since the sheet never subtracted it either; 62 rows on prod at apply time. `check_boe_status_transition` returns early for any role but `authenticated`, so the migration's direct UPDATE needs no trigger bypass (the issue's worry about one was unfounded). The importer's generated SQL predates the column and would fail the completeness constraint on a re-run; the Form is closed and no further import is owed, so it stays as the historical record it is.
- The manager view shows the fee between the sale and the finder's cut in Awaiting Payout and History, names the guild cut as net, and a donated payout reads as the sale net of the fee, never the fee itself. The admin dashboard's payout read-back names the cap.

[Full discussion -> #861](https://github.com/katogaming88/WGA-Raid-Hub/issues/861)

---

## 2026-09-03 -- The BoE alias route went with the Google Form (#750)

The 2026-09-02 entry below planned it: `scripts/boe-names/aliases.txt`, `parseAliasesFile` and the alias block in `catalogSql` were temporary, earning one last run at the delta import from the Form. The Form closed on 2026-09-03 and they are gone. The generated catalog file links `boe_items` rows by catalog name only; a misspelled row is a manager's Edit (#874), and the picker sends the catalog spelling so none arrive in bulk.

---

## 2026-09-03 -- A BoE find is identified by name, track and upgrade rank; no item level column

Tracking issue: [katogaming88/WGA-Raid-Hub#865](https://github.com/katogaming88/WGA-Raid-Hub/issues/865). Two finds of the same item on the same track looked identical in the manager view, and a manager recording a sale had no way to tell which one sold. Raiders had been typing the rank into the item name or the note; the importer stripped it.

- **`boe_items.upgrade_rank text`**, the tooltip's "2/6", under a shape check (`^[0-9]{1,2}/[0-9]{1,2}$`) rather than the six values the form offers. The 61 rows imported from the sheets carry null, the manager's edit form keeps a blank option for them, and a season whose track goes to another denominator changes three option lists (the static options in `index.html`, `BOE_RANKS` in `js/boe-manage.js`, the array in `submit_boe_found`) and no schema.
- **No item level column**, though the issue had one. Within a season a track at a rank is one item level, and the row already snapshots the season, so the level was derivable; it had earned its place only while the rank was optional free text. The one imported row that carried "(Mythic 279)" and no rank keeps the number in its note.
- **Track and rank are required on the raider path only.** The form refuses without them and `submit_boe_found` raises on both, so a stale cached client cannot bypass it; a direct UPDATE from the manager's edit form may still clear either, which legacy rows need.
- **The first-come-first-served rule is a warning at Record Sale, not a block:** an older open row with the same name, track and rank (a rankless row counts as the same item) makes the page name that finder and ask; the manager may know exactly which one sold.
- **The backfill moves a rank-only note into the column** ("2/6" as the whole note was the rank, not a note) and keys on `(team_id, found_at)` like every BoE backfill here.
- Since [#880](https://github.com/katogaming88/WGA-Raid-Hub/pull/880) the raider form's item is a select over the season catalog with no typed fallback, superseding the "free text stays allowed" line in the #875 entry below: a BoE missing from the catalog cannot be reported until the catalog gains it.

[Full discussion -> #865](https://github.com/katogaming88/WGA-Raid-Hub/issues/865)

---

## 2026-09-02 -- A donated BoE payout is a flag on the settle step, not a status

Tracking issue: [katogaming88/WGA-Raid-Hub#862](https://github.com/katogaming88/WGA-Raid-Hub/issues/862). Some finders give their cut to the guild. The sheet recorded that in its Notes column and the Form's note field carried the intent, so on the site a donated sale looked exactly like an unpaid one, Mark Paid claimed gold changed hands that did not, and the guild income totals left the donated cut out.

- **`boe_items.payout_donated boolean not null default false`**, written only by `boe_mark_paid(id, paid_at, donated)` and `submit_boe_found(..., donate)`. Not a status: the lifecycle vocabulary and every status constraint stay as they are, `boe_revert` needs no new edge (paid back to sold leaves the flag; the next settle click sets it either way), and `check_boe_status_transition` blocks the flag on a plain UPDATE without a change, since it is not in the trigger's list of directly editable columns.
- **The money columns do not change.** `finder_payout` stays what the finder was owed under policy and `guild_cut` the policy remainder, so the recognition is visible and #861's auction house fee applies the same way either route. On the page a donated paid row reads Finder payout 0 and the whole amount as guild cut, and guild income counts it that way (Russell, 2026-09-02, on the first cut: the finder elected to take nothing, so History must not show them a cut); the stored split is the policy record Undo Payout restores. The donated total shows on its own line. A sold row that is donating stays outstanding until a manager settles it: the flag before settlement is intent, and only the button decides.
- **The raider's checkbox is intent, the manager's button is the decision.** `submit_boe_found` stores the intent on the row, the page shows it as a Donating marker so the manager knows which button to reach for, and a plain Mark Paid clears it, so a flag can never survive a manager choosing otherwise.
- **Backfill by `(team_id, found_at)`**, listed from the rows whose note already said the cut was donated (nine on 2026-09-02, two of them open finds whose flag lands as the raider's intent), rather than a runtime match on the note that would flag any future note containing the word.

[Full discussion -> #862](https://github.com/katogaming88/WGA-Raid-Hub/issues/862)

---

## 2026-09-02 -- BoEs live in `items` under `is_boe`; the found form picks from them

Tracking issue: [katogaming88/WGA-Raid-Hub#875](https://github.com/katogaming88/WGA-Raid-Hub/issues/875). The found form's item field was free text, and the tracker held 23 spellings for 17 real items across 66 rows. #874 is the repair half (a manager corrects a row); this is the prevention half.

- **`items.is_boe boolean not null default false`**, not a table of its own. `boe_items.item_id` already points at `items`, `submit_boe_found` already resolves the name there, `fetchSupabaseItems()` already loads the table, and #852's direction is one complete item database per season. The price is one skip in `buildItemMaps()`: a flagged row goes into `DATA.boeItems` and into no other map, so the BiS grid, the wishlist, the Priority tab, the boss filters and the equipped-gear lookup never see one.
- **The catalog rows are a generated data file, not a migration.** `seed.sql` inserts `items` ids 1 to 3 explicitly after migrations run, so sequence-assigned rows in a migration collide on the primary key at every reset. `scripts/fetch-boe-items.js` resolves the names in `scripts/boe-names/*.txt` through Wowhead's suggestion endpoint (the zone page has no trash-drop list, which is also why #852's bulk import would miss them) and writes `data/sql/boe-catalog.sql`, applied through `psql service=wga-admin` at a checkpoint like the history import (#749). Idempotent by construction: the insert skips an existing spelling and every link guards on `item_id is null`.
- **`submit_boe_found` links BoEs only, case-insensitively, and stores the catalog spelling.** A find is a BoE, so a same-named boss drop would be the wrong link; `items_lower_name_key` is unique on `lower(name)`; and storing `i.name` keeps the server agreeing with both clients when the items read has not resolved. Same signature, so no grant churn. Consequence accepted: `import_rclc_loot` resolves by name too and would now link a BoE that came through RCLC, which is harmless.
- **A native `<datalist>`** on both forms rather than a hand-rolled picker: type-to-filter, keyboard and screen-reader support for free, and free text stays allowed so a find can be reported before the catalog knows the item. The raider form offers the viewed season's BoEs (by `wcl_zone_id`, through the same helper the season filter uses, failing open to every BoE when the season has no zones); a case-insensitive match submits the catalog spelling. The manager's edit form does its own small public read of `items where is_boe`, and Save writes `item_id` with the name so the link and the text can never disagree.
- **Known misspellings are aliases by spelling** (`scripts/boe-names/aliases.txt`, `wrong => Catalog Name`), not rows keyed by `(team_id, found_at)` as the issue first sketched: spellings need no prod ids, the file can be tracked, and the link keeps the submitted spelling in the row's note so nothing a raider typed is lost. The file is temporary: the picker sends the catalog spelling, so misspellings no longer arrive in bulk, and a single one is a manager's Edit (#874). It earns one more run at the #750 delta import from the Form, then goes with the Form in the close-out PR.

[Full discussion -> #875](https://github.com/katogaming88/WGA-Raid-Hub/issues/875)

---

## 2026-09-02 -- build_rclc_export: split Hero/Myth into separate export strings

Tracking issue: [katogaming88/WGA-Raid-Hub#859](https://github.com/katogaming88/WGA-Raid-Hub/issues/859). The combined Hero+Myth export string measured ~68.5k raw JSON chars / ~91k base64 chars live against team 1's full roster/season -- pasting that into the RCLootCouncil_PriorityLoot addon's import box stalled the WoW client for several seconds, close to a disconnect. Confirmed independent of the addon's EditBox rendering: switching it from multiline (word-wrapped) to single-line (#853, [addon PR #53](https://github.com/katogaming88/RCLootCouncil_PriorityLoot/pull/53)) didn't fix it -- the addon's Lua has no paste handler left to blame either, so the stall is inside WoW's native paste-into-EditBox handling itself. The string is just too large, full stop.

- **`build_rclc_export(p_team_id, p_season, p_track)`** -- `p_track` (`'Hero'`/`'Myth'`) is now required, scoping the `priority` half of the payload to one track (roughly halving it). `players` (BiS data) and `statusLabels` aren't track-specific and stay whole in both halves -- they're small (one entry per player's BiS picks, not per-item ranked lists across 100+ items).
- **Old 2-arg signature dropped outright**, not kept as an overload -- both known callers (Priority tab, Quick Actions) are updated in the same change; a stray caller silently getting a half-empty export would be worse than a clean break.
- **Rejected chunked multi-part paste** (splitting into fixed-size pieces the addon concatenates before decoding) as the primary fix -- more robust in theory against arbitrary future growth, but Kat's call was to keep it simple and match the ~50/50 size split, reusing the Heroic/Mythic toggle idiom the Priority List tab already has (#851).
- **Frontend:** Priority tab's export card gets a Heroic/Mythic toggle (`switchPrioExportTrack`, same shape as `switchPriorityListDiff`); Quick Actions gets two buttons instead of one.
- **Addon-side counterpart** (separate repo): `RCPL_Data_SaveImportedData()` no longer wipes `RCPL_DB.priority`/`players` on every import -- it merges per-item track keys instead, so importing Hero then Myth (either order, or re-importing just one track later) accumulates into one complete dataset. `/rcpl reset` is the explicit "start fresh" action for officers who want a clean slate.

[Full discussion -> #859](https://github.com/katogaming88/WGA-Raid-Hub/issues/859)

---

## 2026-09-02 -- generate_priority_order: exclude OS/M+ RCLC responses from counting as received loot

Tracking issue: [katogaming88/WGA-Raid-Hub#856](https://github.com/katogaming88/WGA-Raid-Hub/issues/856). The `recip` CTE treated _any_ `rclc_loot` row for a player/item/season as "already received this" (drives the has_myth/has_hero/has_champ exclusion and softening multipliers), regardless of the RCLC response label actually selected. An off-spec (OS) or Mythic+ (M+) roll response isn't a loot council award for that character's main spec, so it shouldn't suppress or soften future priority the way an actual MS award does.

- **`recip`'s `rclc_loot` subquery now excludes rows whose `response` contains "OS" or "M+" as a standalone token**, case-insensitive word-boundary match (`response` is guild-configurable freeform text, not a fixed vocabulary -- e.g. "Top Pick"/"Need" already seen live -- so exact-match wasn't safe).
- **Loot history/reporting is untouched.** These rows still land in `rclc_loot` and any officer report views over it; only `generate_priority_order()`'s exclusion/multiplier logic ignores them now.
- **`self_received_requests` is unaffected** -- it has no `response` column; those are always intentional officer-approved claims, not RCLC roll responses.

[Full discussion -> #856](https://github.com/katogaming88/WGA-Raid-Hub/issues/856)

---

## 2026-09-01 -- priority_stale_dismissals: let officers dismiss stale-after-Heroic Priority List conflicts too

Tracking issue: [katogaming88/WGA-Raid-Hub#850](https://github.com/katogaming88/WGA-Raid-Hub/issues/850). Same-boss Priority List conflicts were already dismissible (`priority_conflict_dismissals`) -- an officer who reviewed one and confirmed it's fine could acknowledge it so the banner stopped re-flagging it. The other conflict kind the same banner shows -- a Mythic #1 who already has the Heroic version of that exact item (`priority_order_stale_after_heroic`) -- had no such path.

- **New `priority_stale_dismissals` table**, sibling to `priority_conflict_dismissals` (same RLS policy shape, same `check_team_id_matches_player()` trigger, same nullable `player_id` via `ON DELETE SET NULL`), but keyed by (team, player, season, item) instead of (team, player, season, boss, track) -- a stale entry has no boss/track pairing of its own; the underlying view is always Myth-track by definition.
- **Rejected reusing `priority_conflict_dismissals` directly.** Its `boss`/`track` columns are NOT NULL, and its unique constraint would need a partial-index rework to safely support a second, differently-shaped key (player+item) alongside the existing one -- Postgres doesn't treat two NULLs as equal for uniqueness purposes, so a plain nullable-column approach risked silent duplicate dismissal rows.
- **Frontend:** `getPriorityListConflicts()` (js/tabs/tab-priority.js) filters `DATA.priorityStaleAfterHeroic` against `DATA.priorityStaleDismissals` the same way it already filters same-boss groups. The banner's per-row Dismiss button and the collapsed "N dismissed" section now cover both conflict kinds together.

[Full discussion -> #850](https://github.com/katogaming88/WGA-Raid-Hub/issues/850)

---

## 2026-08-31 -- priority_order_confirmed_empty: mark a deliberately-empty priority list so it stays out of Unmanaged Items

Tracking issue: [katogaming88/WGA-Raid-Hub#847](https://github.com/katogaming88/WGA-Raid-Hub/issues/847). Sometimes nobody legitimately wants a given item/track -- an officer opens Priority Edit, finds no candidates, and saves with zero players ranked. `save_priority_order()` had no way to represent that: a zero-player save just deletes any existing `priority_order` rows and inserts nothing, so there was nothing left in the DB to distinguish "officer confirmed empty" from "nobody has ever touched this." `_isFullyManaged()` (js/tabs/tab-priority.js) only checks whether the `heroic`/`mythic` key is present at all, and both cases looked identical -- a deliberately-empty item fell right back into Unmanaged Items on the next reload or Season View switch.

- **New `public.priority_order_confirmed_empty`** marker table, one row per team/season/item/track, upserted/cleared by `save_priority_order()` itself (not written directly by the frontend). A zero-player save upserts the mark; a later save of the same item/track with a real roster clears it.
- **Rejected a NULL `player_id` sentinel row in `priority_order` itself.** That table's `player_id` is NOT NULL with an FK/unique-constraint shape several other readers (RCLootCouncil export, drift check, fairness warnings) assume is always a real player -- a marker row there risked silently corrupting those. A separate table keeps every existing `priority_order` consumer untouched.
- **Frontend:** `fetchSupabasePriorityOrderConfirmedEmpty()` (js/common.js) fetches the marks; `mapSupabasePriorityOrder()` seeds an empty-but-present array for that diff from them, which is all `_isFullyManaged()` needs to treat the item as handled. `prioEditSave()` (js/tabs/tab-priority.js) mirrors the same upsert/clear into the local raw-rows cache so the effect is immediate, not just after a reload.

[Full discussion -> #847](https://github.com/katogaming88/WGA-Raid-Hub/issues/847)

---

## 2026-08-31 -- player_equipped_gear: equipped-gear-level awareness for priority generation

Tracking issue: [katogaming88/WGA-Raid-Hub#845](https://github.com/katogaming88/WGA-Raid-Hub/issues/845). `generate_priority_order()` only ever compared a candidate's loot-award history for the _exact item_ being generated against the track being generated -- no way to see "this raider already has a Hero-equivalent item equipped in this slot, just a different one" (e.g. a Hero belt from an earlier boss shouldn't leave someone first priority on a different Hero belt drop).

- **Data source: the Blizzard API's Character Equipment Summary endpoint, not Raider.IO.** First drafted against Raider.IO (keyless, no OAuth needed), then switched after Kat pointed out this project already has `BLIZZARD_CLIENT_ID`/`BLIZZARD_CLIENT_SECRET` set up for `scripts/fetch-item-stats.js`, and that Blizzard's API returns an item's track directly. Confirmed live against 3 real roster characters: `equipped_items[].name_description.display_string` gives `"Normal"`/`"Heroic"`/`"Mythic"` for a raid-track piece (and other strings entirely for Mythic+/crafted/catalyst gear -- see below). Since OAuth client-credentials can't be exposed to the browser, the officer-triggered on-demand sync moved from a direct client fetch (like the existing Raider.IO tier sync still is) to going through the new `blizzard-gear-sync` Edge Function -- that function accepts both a cron-secret call (full sweep, service role) and a JWT-forwarded officer call (one team, or one player), mirroring the existing `twitch-live-check` vs `wcl-sync` split in one function rather than two. The existing Raider.IO-based class-tier sync (`fetchRaiderIoGear`, `applyRaiderIoTierSync`) is untouched -- only equipped-gear-level detection moved.
- **The fairness comparison is raw `item_level >= threshold`, not a track-string match -- deliberately, after a live-data surprise.** The initial design planned to gate the multiplier on the row's `track` label matching the track being generated. Live testing showed `name_description` is a general gear-_source_ descriptor, not raid-track-only (`"Mythic+"` for a dungeon drop, `"Tidal Crafted"` for crafted gear, `"Mythic Sporefused: Myth"` for a special boss-specific item -- not a catalyst conversion, Kat clarified, but a distinct unique item with no raid track of its own -- and no descriptor at all for a Champion-track raid piece unless it dropped from Normal specifically). Kat's call: any equal-or-higher-ilvl gear should count toward "already itemized here," regardless of source -- a Mythic+ piece at Hero-equivalent ilvl suppresses priority the same as an actual Hero raid drop would. So the table still stores a `track` label (exact-matched from `name_description`: `"Normal"`->Champion, `"Heroic"`->Hero, `"Mythic"`->Myth, everything else null) purely for the human-readable status text, but `generate_priority_order()`'s actual multiplier compares `player_equipped_gear.item_level` against `team_settings.config.trackIlvlThresholds` (officer-maintained `{Hero, Myth}` min ilvl per season, same manual-reseed shape `tier_token_map` already has) -- unconfigured thresholds mean the whole factor is a no-op, not a guess.
- **New weighted fairness factor, not a hard exclusion.** Mirrors the existing Champion/Hero same-item multiplier pattern in `generate_priority_order()`, deliberately weaker (0.92x vs. the existing 0.85-1.15x range) -- "already itemized in this slot" is a softer signal than "already owns this exact item," so it stacks on top rather than competing with the existing multipliers.
- **New `public.player_equipped_gear`** table, one row per player per Blizzard API equipment slot -- keyed on Blizzard's own positional vocabulary (`FINGER_1`/`FINGER_2`, `TRINKET_1`/`TRINKET_2`, `MAIN_HAND`/`OFF_HAND`) rather than `items.slot`'s ambiguous type-based Finger/Trinket, since the API already resolves which physical slot each item sits in. Public read (armory-visible data already), officer + service-role write.
- **Refresh: scheduled daily sync via pg_cron, plus an officer on-demand button.** Modeled directly on `twitch-live-check`/`wcl-progression-sync`'s existing secret-header/service-role pattern for the scheduled path.
- Finger/Trinket fan out to both equipment slot keys when matching a candidate's equipped gear (a ring/trinket fits either socket); Weapon and Off Hand deliberately stay separate, matching the existing dual-wield BiS dedupe decision -- neither fans into the other.

[Full discussion -> #845](https://github.com/katogaming88/WGA-Raid-Hub/issues/845)

---

## 2026-08-28 -- players.archived_reason_detail: required freeform detail alongside the exit-reason dropdown

Tracking issue: [katogaming88/WGA-Raid-Hub#476](https://github.com/katogaming88/WGA-Raid-Hub/issues/476), follow-up to the `archived_reason` dropdown shipped earlier the same day. The fixed-vocabulary category alone (`schedule_conflict`, `drama`, etc.) doesn't capture the specifics an officer actually wants on record -- which guild someone moved to, what the schedule conflict was.

- **New `players.archived_reason_detail text`, nullable, sibling to `archived_reason`.** No CHECK constraint -- freeform by design, the category column already carries the queryable structure.
- **Required at removal time** alongside the reason dropdown -- `executeRemovePlayer()` blocks the removal until both are filled in.
- **Cleared (`null`) on reactivation**, same as `archived_reason`.
- **Audit log detail now reads `"<reason>: <detail>"`** instead of just the reason code.

[Full discussion -> #476](https://github.com/katogaming88/WGA-Raid-Hub/issues/476)

---

## 2026-08-28 -- players.archived_reason: fixed-vocabulary exit reason captured at roster removal

Tracking issue: [katogaming88/WGA-Raid-Hub#476](https://github.com/katogaming88/WGA-Raid-Hub/issues/476). Nothing tracked _why_ a player left the roster, only that they had (`players.archived_at`). Over a few seasons that makes it impossible to spot retention patterns (e.g. losing people right after bench stretches).

- **New `players.archived_reason text`, nullable, sibling to `archived_at`.** No new table -- smallest change that captures the data.
- **Fixed vocabulary via CHECK constraint** (`schedule_conflict` / `performance` / `drama` / `moved_guilds` / `switching_mains` / `other`) rather than free text, backing an officer-facing dropdown in the remove-player confirm panel. Keeps the data queryable for pattern-spotting instead of needing NLP over freeform notes.
- **Required at removal time** -- `executeRemovePlayer()` blocks the removal until a reason is picked, so the column doesn't silently stay null on new removals the way `archived_at`'s companion data has elsewhere.
- **Cleared (`null`) on reactivation** -- `addPlayerToRosterSupabase()`'s un-archive path resets it alongside `archived_at` when a previously-removed name_realm rejoins.
- **Left `null` on the main-swap auto-archive path** (`add_signup_to_roster()` archiving the old character when a new one is promoted). That isn't a real roster exit -- the player is still active under the new character -- so backfilling a reason there would muddy the column's meaning.

[Full discussion -> #476](https://github.com/katogaming88/WGA-Raid-Hub/issues/476)

---

## 2026-08-27 -- Database default timezone set to America/New_York

Tracking issue: [katogaming88/WGA-Raid-Hub#803](https://github.com/katogaming88/WGA-Raid-Hub/issues/803). Every `timestamptz` column was already stored correctly -- Postgres always stores `timestamptz` as UTC internally, and `import_rclc_loot()`'s `at time zone 'America/New_York'` conversion correctly interpreted RCLC's raid-local wall-clock time before storing it. But the database's session-level `timezone` setting was still Postgres/Supabase's default of `UTC`, so any raw read that doesn't explicitly convert -- Supabase Studio's table grid, an ad-hoc query -- displayed every timestamptz in UTC (e.g. `rclc_loot.awarded_at` showing 1-4am for raid times that were really 9-11pm Eastern).

- **Ran `alter database postgres set timezone to 'America/New_York';` via the Supabase SQL Editor.** Display-only, not a data change -- `timestamptz` values stay stored as UTC internally, this only changes what offset a session sees when reading one back as text, for any session that doesn't set its own `timezone` explicitly.
- **Database-wide, not scoped to `rclc_loot`.** Every `timestamptz` column across the schema now displays in Eastern by default in Studio/raw queries, not just `awarded_at`.
- **Doesn't touch app correctness.** The app's own JS formatting (`mapSupabaseLoot()`'s explicit `timeZone: 'America/New_York'`, etc.) already converted to Eastern regardless of the source string's offset -- an absolute instant parses identically in JS no matter which offset Postgres renders it with.

[Full discussion -> #803](https://github.com/katogaming88/WGA-Raid-Hub/issues/803)

---

## 2026-08-27 -- rclc_loot: capture RCLC's response label going forward

Tracking issue: [katogaming88/WGA-Raid-Hub#801](https://github.com/katogaming88/WGA-Raid-Hub/issues/801). `rclc_loot` never stored RCLC's own response label per award (Need/Greed/Off-spec, or a guild's custom labels like "Top Pick"/"Side Piece") -- `submitLootImport()` only ever picked `id/player/date/time/itemID/itemName/instance/boss` off each RCLC export entry, silently dropping `response` on the way in. Surfaced when Hellfire wanted a one-time cleanup of already-imported rows by response type, which turned out to be impossible without the original export.

- **New `rclc_loot.response text`, nullable, no CHECK constraint.** RCLC lets each guild configure its own response labels, so unlike `track` (a real fixed Champion/Hero/Myth set) there's no fixed vocabulary to validate against.
- **`import_rclc_loot()` now extracts and stores it** (trimmed, null if blank) alongside the existing columns.
- **Existing rows stay `null`, unrecoverable from the DB alone** -- same gap already accepted for pre-season-tracking `audit_log` detail rows. A one-time cleanup for already-imported rows needs the original RCLC export cross-referenced by `rclc_id`, tracked separately once that's in hand.

[Full discussion -> #801](https://github.com/katogaming88/WGA-Raid-Hub/issues/801)

---

## 2026-08-26 -- rclc export: attach wishlist status to the ranked priority list, additive only

Tracking issue: [katogaming88/WGA-Raid-Hub#760](https://github.com/katogaming88/WGA-Raid-Hub/issues/760). The RCLootCouncil_PriorityLoot addon's voting-frame panel only ever showed a bare rank ("3rd") with no sense of whether that's a raider's real BiS pick, a lower-tier Good/OK pick, or not backed by a wishlist entry at all.

- **New `<track>_status` sibling keys in `build_rclc_export()`'s priority payload** (e.g. `H_status: {"Name-Realm": "bis"}`), sourced from `item_preferences.status` joined against `priority_order` by player+item. Sibling keys rather than restructuring the existing `H`/`M` name arrays -- an addon client that hasn't picked up the new field simply ignores the extra key, so this doesn't force a synchronized addon release.
- **Sparse by design**, not a placeholder value for every rank. A ranked player with no matching `item_preferences` row (fallback ranking signals like tier-token matching can place someone with no wishlist entry backing it) is simply absent from the status map, so the addon can render "nothing extra" rather than a misleading tag.
- **Only bis/good/ok are attached** -- `catalyst` and `pass` are `item_preferences.status` values too, but neither is a "wants this" wishlist tier in the sense this feature is surfacing.
- **Loot-council-only surface, by product decision (Kat) not a technical constraint**: the addon only shows this in the officer voting frame's "Full Priority Order" panel, never the raider-facing loot roll frame -- the export itself doesn't distinguish who's allowed to see it (the whole payload is already officer/team_leader-gated at the RPC level).
- **New top-level `statusLabels` object, merging each team's Wishlist Tier Labels (`team_settings.config->'wishlistStatusLabels'`, officer-editable, #515 Phase 2) over the site's own bis/good/ok defaults.** Caught before merging: a hardcoded "BiS"/"Good"/"OK" in the addon would already have been wrong for at least one live team, which has overridden `good` to "2nd Choice" and `ok` to "Sidegrade". Merged server-side (not left sparse like the per-item status map) so the addon always gets a complete 3-key label set with zero label logic of its own to keep in sync with the site's defaults.

[Full discussion -> #760](https://github.com/katogaming88/WGA-Raid-Hub/issues/760)

---

## 2026-08-25 -- Self-received corrections: delete is an RPC, revert is the existing UPDATE policy

Tracking issue: [katogaming88/WGA-Raid-Hub#756](https://github.com/katogaming88/WGA-Raid-Hub/issues/756). Approve/reject on the Requests tab were one-way doors: approved rows vanished from every UI surface, and 8 exact duplicate approved rows (raiders resubmitting when feedback failed, the v3.61.1 bug) had no cleanup path short of the site-admin whole-team wipe.

- **Delete is a SECURITY DEFINER RPC (`delete_self_received_request(p_id)`), not a new DELETE policy.** The table deliberately has no DELETE policy for anyone, and the docs/RLS.md contract is that request-table writes go through definer functions only; a policy would loosen that for every ad-hoc client query. The RPC is the per-row officer-tier complement to `danger_clear_self_received_requests()` (site-admin, whole-team).
- **Revert-to-pending needs no backend at all.** The existing `Officers update self_received_requests` policy carries a plain status UPDATE (the same shape approve/reject already use), and `check_team_id_matches_player` re-validating on the way through is a feature: a row whose player changed teams refuses to revert with a clear error instead of silently landing in the wrong team's queue.
- **Any status is deletable.** Restricting to approved/rejected would only force a reject-then-delete two-step for a pending duplicate, with the same end state and no added safety.
- **Null-player rows delete fine.** `player_id` is ON DELETE SET NULL by schema design, so refusing would strand exactly the rows most in need of cleanup; the audit detail carries a "player no longer on roster" marker instead.
- **The audit entry is written inside the RPC**, action `Self-Received Deleted`, because the row is gone afterwards and a failed client-side follow-up would leave an unlogged delete (`write_audit_log`'s gate is identical to the RPC's own, and a raise there rolls the delete back, failing safe). Target is `players`, never the request row: the Audit tab resolves targets against live tables, and a deleted row would blank TARGET forever. The gate wraps `my_team_role()` in coalesce so a no-role caller is refused rather than slipping through on a null comparison (the #752 shape); `is_guild_officer()` stays excluded like every approval surface here.
- **The one-way `bis_items.obtained` sync stays one-way.** Deleting or reverting an approved row does not untick the BiS Manager box (the 20260725100000 decision stands: an officer may have ticked it by hand for an unrelated reason). The Requests tab compensates with a passive hint on approved rows whose matching `bis_items` row is obtained, pointing at BiS Manager where untick is already an officer action. The two fairness views subquery this table live, so a delete or revert lifts a player's priority exclusion on its own.
- Implemented in `20260826030444_delete_self_received_request.sql`. Tests in `tests/rls/self-received-corrections.test.js` cover the role matrix, the audit entry, null-player deletes, the direct-DELETE dead end, and the revert path including the one-way sync and re-approve edges.

---

## 2026-08-25 -- BoE tracker backend: two-table lifecycle, grant-only writes, gross-sale split

Tracking issue: [katogaming88/WGA-Raid-Hub#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745). Folds the guild-bank BoE workflow (found -> listed -> sold -> paid, plus retire and revert) into the site, replacing a Google Form, an Apps Script relay bot, and a hand-kept sale spreadsheet.

- **Two tables, not one.** `boe_items` holds one row per found BoE with its lifecycle and money receipt; `boe_listings` holds one row per AH listing event. Relists are repeating events with their own timestamp and price, so folding them into lifecycle columns on `boe_items` would lose the history the sheet never captured.
- **No public read.** `boe_items` and `boe_listings` are officer/manager-only (the `item_preferences` privacy call, not the `rclc_loot` transparency call): payouts owed per person and live listing prices are undercutting intel. A finder reads their own rows via `is_own_player(player_id)`.
- **Grant-only writes via a standalone `boe_managers` table**, same shape as `guild_officers` (#607) and `site_admins`. Every money mutation requires a `boe_managers` grant or `is_site_admin()`. Plain officers are read-only, and site admins assign grants through the `admin_*_boe_manager` trio. Managing the guild bank is a deliberate assignment, not blanket officer access, and `is_guild_officer()` passes no BoE gate, matching its exclusion from approvals and loot import.
- **The grant is guild-wide, not per-team** (#766, reversing #745). It shipped hanging off `team_member_id`, so a grant reached one team and self-revoked when its holder lost their officer role there. Both conditions were wrong: BoEs are guild property, and whoever runs the guild bank runs it for the whole guild regardless of which team they raid on. Reshaped to `discord_id` + `auth_user_id` with an argument-less `is_boe_manager()`, so the grant now persists until a site admin revokes it, exactly like the other two guild-wide grants. Two consequences worth naming: the read policies on `boe_items`/`boe_listings` had to admit `is_boe_manager()` too, since a manager who can mutate a row they cannot see is a worse failure than either half alone; and `write_audit_log()` had to admit it as well, because its own gate assumed an officer role that a manager no longer needs to hold. The `boe_managers` read deliberately went wider than the `guild_officers` template (any officer on any team, not site admins only), so an ungranted officer looking at a find they cannot act on can see who can.
- **The split formula (guild policy) computes on the gross sale.** finder_payout = 20% of the gross sale or a 20,000g floor, whichever is larger, capped at the sale itself; guild_cut is the rest and is never negative. The 5% AH cut is not modeled: the guild absorbs it, which keeps the math the managers do by hand simple. Verified against last season's 46-row tracking sheet, both rounding directions included; a sub-floor sale (the sheet never had one) pays the finder the whole sale and the guild takes zero.
- **Considered and rejected: a percent-of-net guild cut with `ah_cut`/`ah_cut_pct`/`guild_cut_pct` snapshot columns** (the issue's original design). The real policy is a floor-or-percentage on the gross, so those columns came out; `payout_floor` and `payout_pivot` snapshot the two constants that actually drive it.
- **Payout constants are guild-wide, not per-team.** `boe_payout_floor` and `boe_payout_pivot` live on the `site_settings` singleton (public read, `set_boe_payout_settings()` SECURITY DEFINER site-admin-only write), not `team_settings`, because the guild runs one policy across every team. Each sold row snapshots the values in force, so history survives a policy change.
- **Finder free-text fallback.** `submit_boe_found()` resolves the name to a `players` row when it can but is non-fatal otherwise (null `player_id`, raw `finder_name` kept), and resolves the item against the catalog opportunistically (`item_id` usually null, `item_name` is the identity). A found BoE is a fact, not a request, so there is no approval state.
- **Lifecycle edges live in the RPCs, not an unconditional trigger.** `check_boe_status_transition` blocks a plain UPDATE from moving status/money/timestamps (metadata edits still pass), but the legal-edge set is enforced per-RPC with a `select ... for update` lock first, because `boe_revert`'s correction edges run backwards and an unconditional forward-edge trigger (the `restrict_bis_items_update_to_obtained` shape) would block the revert itself.
- Implemented in `20260825225243_boe_tracker.sql`. Tests in `tests/rls/boe.test.js` cover the RLS matrix, the manager gate on every RPC, the lifecycle transitions, the split formula (vectors transcribed from the sheet), and the revert edges; the shared `write-policies` and `read-matrix` suites gained the three tables.
- **Historical import (#749, 2026-09-01) is a one-time SQL file from `scripts/import/boe.js`, not a replay through the RPCs.** Sales land as `paid` with `payout_paid_at = sold_at` (the gold changed hands at the time), the cuts exactly as the sheet recorded them (the generator checks every row against the formula and warns on a mismatch rather than correcting it), and `payout_floor`/`payout_pivot` snapshotted at the 20,000 / 100,000 the sheet was kept under. No `boe_listings` rows exist for them, so `boe_revert` on an imported sale lands on `found`, not `listed`. Sales match Form submissions by finder and item, never by team: the earliest submissions predate the Form's team question, and the sold sheet's spelling, team and track win wherever the two disagree, because it is the payout record. Idempotency is `NOT EXISTS` on `(team_id, found_at)` with `item_name` deliberately outside the key, so a find that sells between two runs (and takes the sold sheet's spelling) never doubles; the flip side is that a sale the sheet records against an already-imported open find is skipped by a re-run and gets recorded in the app instead. The exports pair finder names with payout amounts, so they live only in the gitignored `data/boe/` directory and are never attached to the tracker.

---

## 2026-08-22 -- `import_rclc_loot()` carries season into its audit detail

Decided directly in conversation (no tracking issue): the Loot Import tab's history view (previously a flat per-item table) was rebuilt to group entries into one row per import event and needed to season-scope that list, but `audit_log` has no season column and `rclc_loot.season` (already written by this same call) has no reference back to which import wrote it -- there's no reliable way to join the two after the fact.

- `import_rclc_loot()`'s `write_audit_log()` call now writes `{summary, season}` as the detail jsonb instead of a bare summary string, since `p_season` is already available in that same function call. One extra field, no new column.
- **Rows written before this migration keep their old plain-string detail and have no season to filter by.** Retroactively backfilling one is not feasible: correlating a specific `audit_log` row back to the exact `rclc_loot` row it came from would require reconstructing insertion-order pairing across two separate id sequences, which is fragile enough (and unverifiable after the fact) that it was ruled out rather than attempted. The history view surfaces these under an explicit "Unknown season" bucket instead of guessing one, so nothing silently disappears or gets misattributed to whichever season happens to be active now.
- This changes what "Loot Imported (RCLC)" actions render as on the general Audit Log tab too (`formatAuditDetail()` flattens the new `{summary, season}` object into "Summary: ..., Season: ..." instead of the old bare string) -- accepted as a minor side effect of the same detail column, not worth a separate code path just to preserve the old rendering for one action type.
- Implemented in `20260822163718_import_rclc_loot_audit_season.sql`.

---

## 2026-08-22 -- `restrict_players_self_update_to_bonus_roll()` trigger missed the `is_site_admin()` catch-up

Decided directly in conversation (no tracking issue): a site admin with no `team_members` row on Hellfire and no `guild_officers` row hit a 400 on every `players` PATCH while running the Reports tab's bulk Raider.IO tier sync (`syncRosterTierCounts()`) against that team -- the RLS policy on `players` already allows `is_site_admin()` through (per the 2026-08-15 sweep below), but this trigger is a hand-mirrored copy of that predicate living in a separate function, not a `CREATE POLICY` statement, so the 2026-08-15 sweep's own audit (which looked for officer-write policies) never touched it.

- `is_site_admin()` added to the trigger's bypass check, alongside the existing `my_team_role`/`is_guild_officer()` clauses, matching the RLS policy it's meant to mirror.
- `20260809220657_players_bonus_roll_target.sql`'s own comment already flagged this exact drift risk ("if that policy's predicate changes, update this to match... starts getting wrongly blocked here") -- it just wasn't caught when the 2026-08-15 sweep landed.
- Implemented in `20260822194907_players_self_update_trigger_site_admin.sql`.

---

## 2026-08-17 -- `generate_priority_order()`: `avg_existing_rank` fairness tiebreaker

Decided directly in conversation (no tracking issue), following on from the Suggest Order re-click fixes (3.60.13/3.60.14 -- see CHANGELOG): those fixes only ever nudged the #1 slot away from someone who already held rank 1 on another item, and only on a manual re-click. Two gaps remained: every OTHER rank in a suggested list (not just #1), and every FIRST click, still ignored how much priority a candidate already carried across the rest of the priority order -- and nothing corrected the opposite failure mode either, where a consistently lower-scoring raider could sit near the bottom of _every_ list, every time, since two equally-unstacked candidates just fell back to raw score.

- **One metric handles both directions**, rather than two separate mechanisms: `avg_existing_rank`, each candidate's average `rank` across every OTHER item/track they're currently placed on this season (excludes the row for the exact item+track being generated, so a stale self-reference from the row about to be replaced doesn't count against them). Sorted descending with nulls first -- a great average (near 1, already well-prioritized) sorts later here; a poor average (10+, habitually low) sorts earlier, a genuine boost; no placements at all (null) sorts earliest of all, since that candidate has the least existing priority of anyone.
- **Considered and rejected**: a coarse rank-1/2/3-only weighted bucket sum (rank 1 = 3 points, rank 2 = 2, rank 3 = 1, rank 4+ = 0). Caught in review before shipping -- it only ever discouraged stacking at the very top and treated every rank below 4 identically, so it couldn't distinguish "always rank 10" from "never placed at all," and did nothing for the "boost the habitual bottom-dweller" half of the ask.
- **Slotted as a new hard sort tier, positioned after tier-piece catch-up (`tier_rank`) and before raw performance score** -- it only breaks ties among candidates who are already equally deserving (same wishlist tag, same tier-piece need). It never overrides an actual BiS/tier need with a fairness nudge; a BiS pick with heavy existing load still outranks a Good-tier pick with none.
- **Purely an internal sort factor, not a new output column** -- `CREATE OR REPLACE` (not `DROP FUNCTION`) since the return shape is unchanged, so `check_priority_order_drift()`'s hardcoded ordinality column list needed no update this time (contrast the 2026-08-11 entry below, where adding `wishlist_status` as an output column did require that).
- Implemented in `20260817135343_generate_priority_order_existing_load.sql`. New tests in `tests/rls/priority-existing-load.test.js` cover: no-placements beats holding rank 1 elsewhere; a poor average beats a great average; the current item/track's own stale row is excluded from its holder's average; wishlist tier always wins regardless of existing load.

---

## 2026-08-15 -- `wishlist_setup_status()` function for the Discord bot's missing-data nudge

Tracking issue: [katogaming88/wga-raid-bot#8](https://github.com/katogaming88/wga-raid-bot/issues/8). The bot needs to know, per team, which active raiders are missing a wishlist entirely, missing a BiS source link, or have a wishlist with rows still missing a real BiS pick, so it can DM them without an officer manually checking. Two things were decided:

- **The bot connects directly with the service-role key**, not through a new web-app endpoint. The bot repo doesn't yet have a Supabase dependency, but it's the simplest option -- no new endpoint to build/deploy/auth in this repo, and it matches where the app already is (fully Supabase-native, GAS retirement complete). Revisit if a second bot-facing use case appears and a proper API surface starts to pay for itself.
- **`missing_bis_rows` reproduces `wishlistCompleteness()`'s "missing a real BiS pick" rule** (`js/wishlist.js`, #690) rather than a simpler "every slot has some tag" check. Confirmed with a live example (WISHLIST 100% (45/45), but 5 slots with no actual BiS-status pick) that the simple check would have missed entirely -- everything Good/OK-tagged reads as "done" even though the BiS List silently falls back to a non-BiS pick. The port includes the Finger/Trinket sibling-mirroring rule, the one-hand-weapon-makes-Off-Hand-required rule (both the raider's own tag and the officer's `bis_items` pick), and `wishlistOfficerRowBuckets`'s greedy legacy-row assignment (explicit `bis_items.slot` claims its row first, unslotted legacy rows fall back to their catalog slot's first open row in `id` order).
- **No shared source with the client-side logic** -- same accepted tradeoff as `wishlistOfficerRowBuckets`'s own "own copy" comment. If `wishlistCompleteness()` changes, `wishlist_setup_status()` needs a matching update or the bot's nudges will drift from what the Wishlist tab actually shows.
- Implemented in `20260815162755_wishlist_setup_status_bot.sql`.

---

## 2026-08-15 -- `is_site_admin()` OR'd into every remaining officer-write policy

Decided directly in conversation (no tracking issue): a site admin without a `team_members` row on a given team hit RLS write rejections there -- surfaced live as "new row violates row-level security policy for table player_wcl_season_perf" when fetching WCL performance for Hellfire from an admin session with no officer role on that team. `is_site_admin()` was already OR'd into most officer-_view_ policies (`item_preferences`, `audit_log`, `team_members`) but had never been extended to the officer-_write_ policies on ten tables: `players`, `attendance`, `bis_items`, `item_preferences` (note-clear UPDATE), `player_wcl_season_perf`, `priority_order`, `rclc_loot`, `scoring`, `streamers`, `team_raid_progress`.

- **Full sweep, not a single-table patch.** Given the choice between fixing only `player_wcl_season_perf` (the table that actually errored) or auditing every officer-write policy for the same gap, went with the full sweep -- the same silent rejection would have resurfaced the next time an admin touched a different table on a team they hadn't personally claimed a character on.
- **Deliberately distinct from the `is_guild_officer()` (#607) scoping.** Guild officer access is narrower by design -- excluded from approvals, season settings, priority generation, and loot import (see the 2026-07-30 guild-officer-tier decision below). `is_site_admin()` carries no such carve-out anywhere else in the schema; every other officer-gated policy already passes a site admin unconditionally, so the write policies were simply catching up to that existing convention, not establishing a new one. `priority_order`/`rclc_loot` in particular now admit `is_site_admin()` while still correctly excluding `is_guild_officer()`.
- **Reverses part of the 2026-08-10 `item_preferences` decision below**, which deliberately left the note-clear UPDATE policy scoped to `my_team_role` only ("broadening write access... wasn't asked for and wasn't touched"). It's asked for now.
- Implemented in `20260815010941_site_admin_officer_write_policies.sql`.

---

## 2026-08-12 -- `update_own_signup()`/`get_own_signup()`: don't reset status on a no-op edit, and use the live roster as source of truth once added

Decided directly in conversation (no tracking issue): `update_own_signup()` unconditionally reset an `'approved'`/`'added'` signup back to `'pending'` (clearing `approved_player_id`/`reviewed_*`) on _every_ edit call, even one that changed nothing. Confirmed live -- Khaosmagi (Mage/Arcane, already on the roster as Mage/Arcane) opened their already-added signup and hit Submit without changing anything, and it bounced back into the officer review queue with nothing to actually review. A second, related bug surfaced in the same conversation: `get_own_signup()` (the read side, used to pre-fill "Edit signup") only ever read the signup's own stored snapshot, never the live `players` row -- confirmed live when an officer renamed a roster player directly (Noctrana -> Raintotem) and the raider's own edit form kept showing the old name.

- **Root cause for both**: once a signup is `'added'` (linked via `approved_player_id` to a real `players` row), that row -- not the signup's own stored columns -- is the actual source of truth for name/class/spec, since it's the one thing an officer can still edit independently afterward (Roster tab). Nothing kept the two in sync.
- **`get_own_signup()` fix**: for an `'added'` row, left-joins to the live `players` row via `approved_player_id` and prefers its `name_realm`/`class_spec_id` over the signup's own stored snapshot. `off_specs`/`player_note`/`main_swap`/`swap_from_name_realm` have no roster equivalent to go stale against, so those still come from the signup row as before. A pending/approved-not-yet-added signup has no linked player yet, so it's unaffected -- still reads its own stored values.
- **`update_own_signup()` fix**: before writing, compares the incoming values against _current truth_ -- the live player (via `approved_player_id`) when one exists, the signup's own stored snapshot otherwise -- and only resets `status`/`approved_player_id`/`reviewed_*`/`signup_officer_note` if something actually differs. Getting this right required using the _live_ player as the comparison baseline, not the signup's stored snapshot: if an officer had manually changed the roster since the signup was added, comparing against the stale snapshot would let a raider "no-op" back to values that no longer match the roster (silently contradicting the officer's manual change), while comparing against the live row correctly still treats that as a real edit needing review. Matching the _current_ live state, even if it differs from what the signup itself last recorded, correctly counts as a no-op.
- Implemented in `20260812045902_update_own_signup_noop_skip_status_reset.sql`. New tests in `tests/rls/own-signup.test.js` cover both the no-op skip and the live-vs-stale-snapshot distinction directly.

---

## 2026-08-11 -- `generate_priority_order()`: return raw `wishlist_status`, not pre-formatted text

Decided directly in conversation (no tracking issue): the Priority Order editor showed hardcoded "Wishlist: Good"/"Wishlist: OK"/"Wishlist: Catalyst Only" text, ignoring a team's own custom wishlist status label overrides (`team_settings.config.wishlistStatusLabels`) that every other wishlist display on the site already respects.

- **Split the wishlist tier out of `status_label` into its own raw `wishlist_status` column** (`bis`/`good`/`ok`/`catalyst`/`null`) instead of baking display text into the SQL function -- the client (`js/tabs/tab-priority.js` `prioEditRenderList()`) now builds the label itself from `WISHLIST_LABEL_DEFAULTS` + `labelOverrides`, the same pattern `buildPriorityNotesTab()` already uses. `bis`/untagged still render no label at all, unchanged -- BiS is the default "really keeping this" case, only a sidegrade tag gets called out.
- **Adding a column required `DROP FUNCTION` before recreating** -- `CREATE OR REPLACE FUNCTION` cannot change an existing function's return type/shape in Postgres. The drop also wipes grants, so they're explicitly re-applied in the same migration (officer/team_leader/site_admin only, matching the original 20260710130000 migration).
- **Found and fixed a real bug the column addition exposed**: `check_priority_order_drift()` called `generate_priority_order()` via `WITH ORDINALITY AS t(player_id, name_realm, role, weighted_total, status_label, ord)` -- a hardcoded positional column list sized for the old 5-column shape. The new 6th column silently shifted the real ordinality value onto `wishlist_status`'s text, scrambling the "current top 3" comparison instead of erroring. Caught by `tests/rls/priority-order-drift-check.test.js` failing after the column was added -- not something a manual `psql` spot-check against `generate_priority_order()` alone would have surfaced, since that function's own output was correct.
- Implemented in `20260811122020_priority_order_raw_wishlist_status.sql`. `tests/rls/priority-wishlist-ranking.test.js` updated to assert `wishlist_status` directly instead of substring-matching `status_label`.

**Second, related change, same migration:** live case reported -- Torbjorn (tagged 2nd Choice) ranked above Katorri (tagged BiS) on Gebbo's Bottomless Bag when generating a Heroic priority order. Root cause was two separate things:

- Wishlist status only ever affected ranking as a **multiplier on `raw_score`**, not a hard sort tier, for regular (non-tier-token) items -- a well-performing 2nd Choice raider could out-rank a lower-performing BiS raider. Tier tokens already avoided this via `bis_match_rank`, a binary BiS-vs-sidegrade sort tier ahead of score. **Generalized this into `wishlist_rank`**, a 3-way hard tier (BiS/untagged-bis-pick > Good > OK/Catalyst, tied) applied to every item, checked before `weighted_total` in the `order by`. Tier tokens keep their existing binary split unchanged -- `tier_pieces_equipped` catch-up is a stronger, more specific signal there than a 3-way wishlist split would add.
- Separately, no one on the team had a `scoring` row for the current season at all (`MID2`) -- the #264 "Fetch WCL Performance" seed step (`_seedScoringFromSeasonPerf()`, `js/tabs/tab-season.js`) hadn't been run yet this season transition, so every `raw_score` was `NULL` and the observed order was an arbitrary tie-break, not a real score comparison. Running it seeded most of the roster correctly; that upsert call had no error handling at all (fire-and-forget with no `.then`/`.catch`), so a real failure there would have been completely silent -- added a `.catch`-equivalent `console.error` so a future failure is at least visible, even though this particular run succeeded once retried.
- New tests in `tests/rls/priority-wishlist-ranking.test.js` assert the tiering directly: a lower-scored BiS raider outranks a higher-scored Good raider, OK/Catalyst tie and fall back to score between each other, Good outranks OK regardless of score.

---

## 2026-08-10 -- `submit_bis_link()`: block a second submission while one is pending

Decided directly in conversation (no tracking issue): a raider could resubmit a BiS Source link repeatedly with no guard, piling up duplicate pending `bis_requests` rows in the officer review queue for the same character.

- **Enforced at the RPC, not just the UI.** `submit_bis_link()` is `SECURITY DEFINER`, granted to `anon` (the form runs unauthenticated on the public roster page, per the function's original comment) -- the client never had a reliable way to know its own pending status anyway, since raiders have no read access to `bis_requests` (officer/site-admin only). Added a `raise exception` guard before the insert rather than adding raider-facing read access + client-side hiding, keeping the fix scoped to the actual reported problem.
- **Mirrors `flag_bis_list_changed()`'s existing dedupe** (`20260726101533_flag_bis_list_changed.sql`), which already no-ops a re-flag of the same still-pending link -- this is the equivalent guard for a genuinely new submission.
- **Client now surfaces the RPC's actual error message** (`js/common.js` `submitBiSForm()`) instead of a generic "Failed to submit" -- raiders see exactly why (already pending, submissions closed, blank link), all of which the function already raised as distinct exceptions.
- Implemented in `20260810224022_submit_bis_link_block_duplicate_pending.sql`. Covered by `tests/rls/submit-bis-link.test.js` (rejects while pending, succeeds with none pending, succeeds again once the prior request is resolved).

---

## 2026-08-10 -- `item_preferences`: extend read access to site admin / guild officer

Decided directly in conversation (no tracking issue): a site admin (assuming the guild officer tier too) couldn't see another team's raider wishlist tags at all -- `item_preferences` was missed when guild-officer tier (`20260730113259_guild_officer_tier.sql`) extended cross-team view access to `audit_log`/`team_members` read.

- **Same "view-only" category as `audit_log`/`team_members`**, not the "denied" category (approvals, season settings, priority generation, loot import -- actions a guild officer is deliberately excluded from). Reading a raider's wishlist tags is passive visibility, not an action, so it follows the `audit_log`/`team_members` precedent: `alter policy "Officers read item_preferences" ... using (... or is_site_admin() or is_guild_officer())`.
- **The officer UPDATE grant (note-clear) was deliberately left scoped to `my_team_role` only**, not extended the same way -- the read gap was the reported problem; broadening write access to a table that already has a narrow, only-recently-added officer write path wasn't asked for and wasn't touched.
- Implemented in `20260810214342_item_preferences_site_admin_guild_officer_read.sql`. Covered by 2 new cases in `tests/rls/item-preferences.test.js` (site admin and guild officer both see a team-1 raider's row).

---

## 2026-08-10 -- `generate_priority_order()`: match wishlist tags by item_id, not slot = null

Found while investigating an unrelated question about an orphaned `item_preferences` row on a raider's profile: `generate_priority_order()`'s wishlist CTE (`20260720165552_priority_wishlist_ranking.sql`) has filtered `ip.slot is null` since it shipped 2026-07-20. That was a no-op at the time -- every real item's row had `slot = null` unconditionally, only placeholder (Other Sources) rows carried a slot. Two later features started writing an explicit slot on real items too and neither updated this function: Finger/Trinket disambiguation (#623, 2026-08-01) and the Weapon/Off Hand dual-wield fix (#673, 2026-08-08).

- **Real-world impact:** since 2026-08-01/08-08 respectively, any status a raider tagged on a Finger 1/Finger 2/Trinket 1/Trinket 2/Weapon/Off Hand item was invisible to priority-order generation -- including `pass`. A raider explicitly passing on one of these items was silently still eligible to be suggested for it. Caught live on one raider (Torbjorn) whose four `pass`-tagged weapons were, in practice, only still excluded because his _pre-disambiguation legacy rows_ (the ones the bug actually read) happened to still exist untouched.
- **Fix:** match on `item_id` alone (drop the slot filter). Since the same `item_id` can now carry more than one row per player (one per disambiguated row it's eligible for -- e.g. a one-hander tagged differently for Weapon vs. Off Hand), collapse to a single best status per player via a ranked `array_agg`. "Best" = most favorable to candidacy, matching the existing multiplier order (bis > good > catalyst > ok > pass/excluded) -- a raider who wants an item in _either_ hand/finger/ring slot is still a genuine candidate for it; only a raider who passed on _every_ row for that `item_id` is excluded.
- **Rejected:** trying to resolve which physical slot a drop "is" and only reading that row's status -- the schema has no notion of which equip slot a specific drop instance will occupy (a one-hander can go in either hand), so there's no principled way to prefer one row over the other except by favorability.
- Implemented in `20260810163045_priority_order_wishlist_slot_aware.sql`. Covered by 4 new cases in `tests/rls/priority-wishlist-ranking.test.js` (explicit-slot status now counted, pass-on-explicit-slot still excludes, best-of-two-hands wins over a pass in the other, all-rows-pass still excludes).

---

## 2026-08-10 -- `item_preferences`: officer can clear (not edit) a raider's note

Decided directly in conversation (no tracking issue): some raiders were leaving redundant/noisy `item_preferences.note` text (e.g. restating "BiS" when the status tier already says so), and the Priority > Notes sub-tab had no way to clean that up -- officers could only read notes, not touch them.

- **Narrow officer UPDATE policy** (`my_team_role(team_id)` officer/team_leader, same predicate as the table's existing officer read policy) plus a restrict trigger, following the now-established shape from `bis_items.obtained` and `players.bonus_roll_encounter_id`: the policy alone only scopes _which row_, so the trigger locks down _what_ the write can do.
- **Stricter than the `obtained`/`bonus_roll_encounter_id` precedents on purpose**: those only restrict _which column_ changes; this restricts the column _and_ the value -- an officer-driven update must set `note` to `NULL`, nothing else. The feature is "clear a note," not "edit a note," and locking the value prevents an officer from quietly rewriting a raider's stated reasoning.
- **Owner-exemption branch reused verbatim** from `restrict_players_self_update_to_bonus_roll()`: `current_user <> 'authenticated'` (service role / SQL Editor / migrations) OR `is_own_player(player_id)` bypass the restriction entirely, so a raider's own existing full-column-freedom self-service policy on this table is untouched -- only a non-owning actor (reaching the row through the new officer policy) is restricted to the note-clear.
- Implemented in `20260810160841_item_preferences_officer_clear_note.sql` and `js/tabs/tab-priority.js`'s `clearWishlistNote()` (Notes sub-tab). Covered by `tests/rls/item-preferences.test.js`.

---

## 2026-08-09 -- `players.bonus_roll_encounter_id`: self-service Bonus Roll target, informational only

Decided directly in conversation (no tracking issue): raiders wanted a way to declare which current-raid boss they're planning to spend their weekly Bonus Roll on until they get the item(s) they're after, so officers have a heads-up when making in-raid loot calls. Split into two pieces up front -- a live in-game addon flag (RCLootCouncil_PriorityLoot's `nonTradeables`-based "already bonus-rolled this pull" column, shipped separately, addon-only) and this web-app piece: a forward-looking planning declaration, not live combat data.

- **Single nullable `players.bonus_roll_encounter_id`** (FK to `raid_encounters`, `on delete set null`) rather than a new table -- one active target at a time, matching how the real Bonus Roll mechanic works (one boss per week). Deliberately **not** fed into `generate_priority_order()` -- a coin doesn't guarantee a win, and mixing "spent real currency" into the same ranking math as tier-piece-count/wishlist-status felt like a different kind of signal. Purely informational: an officer badge (`.tag-bonus-roll`, Roster tab) and a self-service dropdown on the raider's own profile.
- **Narrow self-service UPDATE policy** (`is_own_player(id)`, same predicate as `streamers`/`item_preferences`/`bis_items.obtained`) plus a restrict trigger, since the policy alone only scopes _which row_, not _which column_ -- without it a raider could touch any column on their own `players` row through this policy. The trigger's exemption went through two iterations, both found via the full RLS test suite rather than assumption: it originally checked `my_team_role() = any(['officer','admin'])`, copied from a stale reading of the `players` table's own write policy (the real predicate is `['officer','team_leader']` OR `is_guild_officer()`, changed by an earlier role-rename migration). Settled on `current_user <> 'authenticated'` (covers any privileged/non-PostgREST write, including `archive_current_season()` -- SECURITY INVOKER, so `current_user` never actually changes inside it, meaning the _only_ thing that exempts it is matching the live officer/team_leader/guild-officer predicate exactly) OR that same live predicate.
- **Dropdown data (`raid_encounters`, joined to `raid_zones`) is fetched unfiltered by season and filtered client-side** at render time against `resolveSeasonView()`, not the hardcoded `CURRENT_SEASON` item-catalog-tier constant -- caught live: the first version filtered server-side by `CURRENT_SEASON.code`, which doesn't match a team's actual configured `raid_zones.season`, and also fires before `DATA.seasonView`/`seasonName` exist yet during bootstrap (both wrong, for two different reasons). Matches `isItemInSeasonScope()`'s existing "fetch once, filter at use time" split.
- **Found and fixed a real duplicate-boss-name data issue along the way** (unrelated to this feature's code): two `raid_zones` rows both containing an encounter named "Nymrissa Wavecaller" -- one the live zone (wcl_zone_id 53), one a stale PTR-era zone id (57) for the same mini-raid boss. Deleted the stale `raid_zones` row directly (cascades through `raid_encounters`/`team_raid_progress`); no rows referenced it yet, confirmed via read-only query before deleting.
- Implemented in `20260809220657_players_bonus_roll_target.sql`, `js/bonusRoll.js` (new, index.html-only), and `js/tabs/tab-roster.js`'s Roster tab badge. Covered by `tests/rls/players-bonus-roll-target.test.js` and `tests/frontend/bonus-roll-target.test.js`.

## 2026-08-08 -- `generate_priority_order()`: rank true tier-token BiS holders ahead of sidegrade taggers

Decided directly in conversation (no tracking issue), a follow-up to #651's tier-piece-count weighting (`20260804140751_tier_pieces_priority_weighting.sql`). That change ranked candidates for a tier-token drop purely by how many tier pieces they already have equipped -- so a raider who only tagged this specific token as a sidegrade (Good/OK/Catalyst Only) could still outrank a raider with this exact token tagged as their actual BiS, if the sidegrade tagger happened to be closer to a 2pc/4pc bonus. Kat wants raiders to keep getting set bonuses quickly, but not at the expense of handing a token to someone who's going to replace it later.

- **New `bis_match_rank` sort key**, slotted in between `status_tier` (bench/trial) and the existing `tier_rank` (piece count) in the `order by` clause. 0 (best) for a raider with `status = 'bis'` on this token via `item_preferences`, or with no wishlist row at all but a `bis_items` pick for it -- the same "untagged reads as BiS" treatment the existing wishlist score multiplier already gives that case. 1 otherwise. Neutral (0 for everyone) on non-tier items, same pattern `tier_rank` already uses, so ordering elsewhere is untouched.
- **BiS-match dominates, tier_rank only breaks ties among equally-true-BiS raiders.** A raider with this token tagged BiS and 0/5 pieces still outranks a raider one piece away from a set bonus who only tagged it Good -- confirmed as the intended behavior, not a bug, since "is this raider actually keeping the piece" matters more than "how close are they to a bonus."
- **Doesn't touch candidacy** -- the `bis`/`wishlist` CTEs and the `candidates` union/except are unchanged. This only reorders raiders already eligible to appear.
- **Not a hard lock.** The suggested order is still just a default; officers can hand a drop to someone else in raid based on real-time need (e.g. giving it to a raider continuing into Mythic over one only raiding Heroic), same as always.
- Implemented in `20260808212802_tier_priority_bis_match.sql`, function body only -- no schema/RLS change. New coverage in `tests/rls/priority-tier-bis-match.test.js`.

## 2026-08-08 -- `wcl-progression-sync`: extend the cron sync to Heroic, not just Mythic (#629)

Decided directly in conversation, expanding #629's original ask (automate the AOTC date) to the same live pull-count/best-%/kill-date tracking Mythic already gets, since AOTC is really just one derived fact from that same Heroic data.

- **One unfiltered fights query instead of two filtered ones.** #629 flagged that adding a Heroic query would roughly double this job's WCL API usage. Instead, the `reports()` query dropped its `fights(difficulty: 5)` filter in favor of a bare `fights { ... difficulty ... }` and buckets each fight into a Mythic or Heroic `DifficultyAgg` in the same pass -- no extra request/page loop per zone. LFR/Normal fights ride along in the same response and are simply ignored.
- **`team_raid_progress` gained `heroic_pulls`/`heroic_best_pct`/`heroic_report_code`/`heroic_fight_id`** to sit alongside the `heroic_date` column that already existed (added with #285 but never written to by anything automatic -- only the officer-triggered "Fetch from WCL" button computed a Heroic kill date, and only for the AOTC field).
- **No cron write into `team_settings.config.raidProgression`.** #629 flagged that AOTC only exists inside that JSON blob and a cron merge into it would be uglier than a normalized column write. Sidestepped entirely: the public progression card now prefers the _live_ `team_raid_progress` Heroic kill date on a raid's last boss over the officer-typed `raid.aotcDate` field, falling back to it only when the sync hasn't produced one yet. AOTC updates itself the moment the sync sees the kill, with zero risk of a cron job clobbering an officer's manual entry (there's nothing to clobber -- it never writes there).
- **Displayed per-boss, not just used for AOTC.** Each boss row on the progression card now shows a second Heroic line (kill date once cleared, otherwise live pulls + best % remaining, with a report link when the sync found one) -- the same shape the Mythic row already has via `_renderPullsBadge()`, factored into a parallel `_renderHeroicRow()`. Mythic's own "killed" gating (`boss.mythicDate`, config-JSON, officer-confirmed via Save) is untouched -- only the new Heroic row is fully live/unconfirmed, since there's no equivalent manually-saved per-boss Heroic field to prefer it over.
- Implemented in `20260808164225_team_raid_progress_heroic_columns.sql` (schema only) plus a `wcl-progression-sync` function-body change -- no RLS change, existing "Officers write team_raid_progress" policy already covers the new columns.

## 2026-08-07 -- `update_own_signup()`: allow editing an already-`added` signup while its season is still open

Decided directly in conversation (no tracking issue), found from a screenshot: a raider already promoted to the roster (`status = 'added'`) saw a hard "signup details are locked" message even while the team's signup window for that season was still open and other raiders were still submitting.

- **Root cause**: `update_own_signup()` (from #500) locked any `status = 'added'` row outright, treating "already on the roster" as always meaning "the signup window is closed." Those aren't the same thing -- an officer can (and routinely does) promote signups while the season's signup window stays open for everyone else.
- **The season-open check is free**: `get_own_signup()` already only returns an `added` row while its `season` still matches `team_settings.config.activeSignupSeason` -- once an officer moves that setting on, the row stops coming back and the raider gets a fresh form instead. So "the raider is looking at their added signup" and "signups for that season are still open" were already the same fact; `update_own_signup()` just wasn't using it. The fix re-derives the same check server-side (season match) rather than trusting the client.
- **Edit does not touch the live roster directly.** Considered auto-syncing the edited name/class/spec straight onto the `players` row `add_signup_to_roster()` already created, but Kat rejected that -- an officer should still have to approve any change to someone already on the roster. Instead, editing an `added` signup reverts it to `pending` (clearing `approved_player_id`/`reviewed_at`/`reviewed_by`/`signup_officer_note`, same as the existing `approved`-not-yet-promoted edit path from #500) and sends it back through normal officer review + a fresh `add_signup_to_roster()` promotion, which naturally applies the edit via its existing upsert-by-`name_realm` behavior.
- **`approved_player_id` is nulled alongside the status revert** -- required by the pre-existing `season_signups_player_only_when_added` CHECK (only `added` rows may have it set).
- Implemented in `20260807232530_update_own_signup_allow_added_while_open.sql`, function body only -- no RLS or schema change. `docs/RLS.md`'s `update_own_signup` entry and `tests/rls/own-signup.test.js` updated to match.

## 2026-08-06 -- `add_signup_to_roster()`: compute join_date in America/New_York, not the session's UTC current_date

Decided directly in conversation (no tracking issue), found live: pushing Phoenix's pending roster to active in the evening EDT set new characters' `join_date` one calendar day ahead (Aug 6 EDT showed as Aug 7).

- **Root cause**: `add_signup_to_roster()` used bare `current_date` for a new character's `join_date`. Supabase's DB session runs in UTC by default (confirmed: `show timezone` -> UTC), so `current_date` is "today in UTC," not "today in the raid's local timezone." Past roughly 8pm EDT / 9pm EST, UTC has already rolled to the next calendar day. Same class of bug the rest of this codebase already accounts for elsewhere (`import_rclc_loot()`'s `awarded_at`, `mapSupabaseLoot()` in `js/common.js`) -- just missed here since `join_date` is a plain `date` column, not a `timestamptz`, so there was no obvious "at time zone" spot to reach for.
- **Fix**: compute `v_today := (now() at time zone 'America/New_York')::date` once at the top of the function and use it everywhere `current_date` was used -- both the new-character `join_date` insert and the join_date-carry-over guard added earlier the same day (20260806202156), which compared against `current_date` too and inherited the same one-day-early cutoff.
- **Test coverage**: `tests/rls/promotion.test.js` gained an assertion that a newly-created character's `join_date` matches `(now() at time zone 'America/New_York')::date` computed independently in the test -- proves the fix's actual behavior rather than depending on wall-clock luck (the bug is only externally observable as wrong in the roughly-4-hour daily window where UTC and America/New_York disagree on the date).
- **Swept for the same bug elsewhere**: `current_date` only appears in this function's own migration history across the whole `supabase/migrations/` tree -- no other latent instance found.
- **Known pre-existing bad data not covered by this migration**: Phoenix's roster push tonight straddled the UTC midnight rollover before this fix shipped -- 5 of the pushed characters landed with `join_date = 2026-08-07` instead of `2026-08-06` (`Saucewell-Area 52`, `Khaosmagi-Thrall`, `Sullÿ-Thrall`, `Drowzen-Moon Guard`, `Astraoneiros-Area 52`; ids 176/182/185/190/197). Corrected with a one-off `update ... where id in (...)` run directly against production -- the fix only prevents this going forward, it doesn't repair rows already written under the old function.

## 2026-08-06 -- `import_rclc_loot()`: parse track from anywhere in the instance string, not just after the last hyphen

Decided directly in conversation (no tracking issue), found while backfilling Phoenix's missing Sporefall loot history and noticing every imported row showed "Other" instead of its real difficulty in the Loot feed.

- **Root cause**: track parsing assumed every RCLC `instance` string has the fixed shape `"<Name>-<Difficulty>"` and took everything after the _last_ hyphen as the difficulty word (`regexp_replace(instance, '^.*-', '')`). Sporefall is a Mythic Flex raid (15-25 players), and RCLC's instance string for it is `"Sporefall-Mythic - Flexible Raiding"` -- a second hyphen before the flex qualifier. The greedy match consumed through that second hyphen too, leaving `"Flexible Raiding"` as the parsed suffix instead of `"Mythic"`, so `track` landed `null` on every Sporefall row.
- **Fix**: search the whole instance string for `mythic`/`heroic`/`normal` as a standalone word (case-insensitive, `~* '\mword\M'`) instead of assuming a fixed trailing shape. Robust to whatever comes after the difficulty word. Implemented in `20260806214054_import_rclc_loot_flex_track_suffix.sql`, same 3-arg signature -- function body only, no RLS or schema change.
- **Test coverage added**: `tests/rls/rclc-loot-import.test.js` -- nothing tested this function before. Covers the classic `"<Name>-<Difficulty>"` format, the Sporefall flex format (regression case), an unrecognized instance string staying `null` rather than guessing, item/player resolution, the unknown-player archived-stub path, unresolved-item counting, dedupe-by-`rclc_id`, and the officer/team-leader authorization gate.
- **Pre-existing bad data already backfilled manually**, not by this migration: the 10 Sporefall rows already imported to Phoenix before this fix landed had `track = null`. Fixed with a one-off `UPDATE ... where rclc_id in (...)` mapping each row back to its correct track by hand, run directly against production. Nothing else affected -- Sporefall was the only raid using a flex-qualified instance string so far.

## 2026-08-06 -- `archive_current_season()`: wipe placeholder BiS entries too, not just real items

Decided directly in conversation (no tracking issue), found while walking through what "Start New Season" does before running it on Phoenix tonight.

- **Previous behavior (#498)**: the season-end `bis_items` wipe explicitly excluded placeholder rows (`and not i.is_placeholder` in the DELETE) -- items tagged as "Other Sources" (M+/Crafted/Catalyst), which have no real `wow_item_id` and exist purely to flag a slot as covered by something other than a raid drop. Real item picks were wiped; these carried forward untouched.
- **Why that's wrong**: per Kat, every BiS list/wishlist is scoped to a season the same as real items are -- what a raider wants from a Mythic+ vault, or has crafted, can target a completely different slot next tier. There's no more reason to carry a stale placeholder forward than a stale real-item pick.
- **Fix**: dropped the `is_placeholder` exclusion from the DELETE in `archive_current_season()` -- the whole `bis_items` table gets wiped for the active roster on archive, not just the real-item subset. The season-history snapshot (`v_bis_snapshot`) was never filtered by `is_placeholder` in the first place, so nothing changes about what's preserved in `seasonHistory`. Implemented in `20260806210047_archive_season_wipe_placeholder_bis.sql`, function body only -- no RLS or schema change. Confirmation-dialog copy in `js/tabs/tab-season.js` updated to match (previously said "M+/Crafted/Catalyst entries are kept").

## 2026-08-06 -- `add_signup_to_roster()`: carry `join_date` to the new character on a main-swap archive

Decided directly in conversation (no tracking issue), found while walking through what Phoenix's "Start New Season" / pending-roster push would do before running it tonight.

- **Root cause**: same shape as the `team_member_id` fix below (2026-08-03) but a separate gap the original fix didn't cover. On a genuine main-swap (new character name/realm, distinct from the old one), the new `players` row is a plain insert with `join_date = current_date` -- there's no `(team_id, name_realm)` conflict to trigger the on-conflict branch that would otherwise preserve an existing date. Every main-swap silently reset the raider's displayed tenure to "today."
- **Fix**: capture the archived row's `join_date` alongside `team_member_id`, then apply it to the new row only if the new row's `join_date` is still today's date (i.e. it went through the plain-insert path, not the on-conflict reactivation path). Implemented in `20260806202156_add_signup_to_roster_carry_join_date.sql`, same 5-arg signature -- function body only, no RLS or schema change.
- **Reactivating a previously-archived alt as the swap target still lands on the swapped-from date, not the alt's own original history.** The existing on-conflict branch already refreshes a reactivated archived character's `join_date` to today (same as it refreshes `is_trial`) regardless of this fix -- so there was never an "alt's own date" being preserved for this fix to protect. The swap-carry logic runs after that refresh and overwrites the resulting today's-date with the swapped-from date, same as the plain-insert case. Covered by `tests/rls/promotion.test.js`.
- **No backfill.** Unlike the `team_member_id` fix, this doesn't correct any already-processed signups -- Phoenix's roster push happens after this migration ships, so nothing needed fixing retroactively.

## 2026-08-03 -- `add_signup_to_roster()`: carry `team_member_id` to the new character on a main-swap archive

Decided directly in conversation (no tracking issue): found while investigating why a Hellfire officer (Crilynn-Nesingwary, `team_members.role = 'officer'`) lost dashboard access after a main-swap signup archived her old character in favor of a new one (Vellisara-Nesingwary).

- **Root cause**: `add_signup_to_roster`'s `p_archive_player_id` path only set `archived_at = now()` on the old `players` row -- it never moved `team_member_id` (the Discord account / role link) to the newly inserted row for the new character name. The account link was orphaned onto an inactive, archived character; the new active character came in completely unclaimed.
- **Not officer-specific.** Any raider's claimed-character link breaks the same way on a main-swap, officer or not -- confirmed 11 approved-but-not-yet-pushed main-swap signups on Phoenix at the time, one of which (`Ród-Shadowsong <- Hotstreak-Shadowsong`) also carried an officer's link and would have hit the identical failure if pushed to roster before this fix.
- **Fix**: capture the archived row's `team_member_id` before nulling it out, then apply it to the new row only if the new row doesn't already have one (protects the reactivation path, where an existing archived row matching the new name might already carry its own link). Implemented in `20260803230409_add_signup_to_roster_carry_team_member.sql`, same 5-arg signature as `20260726145742_players_backup_tank_healer.sql`, function body only -- no RLS or schema change.
- **Known pre-existing bad data not covered by this migration**: Crilynn/Vellisara on Hellfire still needs a manual backfill (`players.team_member_id` moved from the archived Crilynn row to the active Vellisara row) since the fix only prevents the bug going forward, it doesn't repair signups already processed under the old function.

## 2026-07-31 -- `generate_priority_order()`: bench/trial sort by tier, not by a second score multiplier

Decided directly in conversation (no tracking issue): an officer flagged that a trial DPS could outrank a long-term healer for the same item, which felt wrong even though nothing stops an officer from manually reordering the generated list afterward.

- **Root cause was structural, not a bad constant.** The old design multiplied `role_mult` (Tank 0.50 / Heal 0.75 / Ranged-Melee 1.0) by a second status multiplier (flat 0.85 trial / 0.45 bench for Ranged-Melee, `role_mult * 0.80`/`0.65` for Tank/Heal) to push bench/trial below full-status raiders. A flat 0.85 for trial DPS is higher than a full-status healer's own 0.75, so trial DPS could beat full heal outright. Retuning the constants to fix that (and the analogous trial-vs-full-tank case) while also preserving trial-lighter-than-bench and dps>heal>tank ordering within each tier turned out to have no solution wider than a razor-thin band -- one shared multiplicative score can't encode two independent orderings (status tier, and role-within-tier) at once.
- **Sort by tier first, role/score second, instead.** `status_tier` (0 full / 1 trial / 2 bench, bench taking precedence if a player is somehow both) is now a pure `order by` key, not a score input. No bench/trial raider of any role can outrank a full-status raider by construction, regardless of role weights -- no constant-tuning needed.
- **Status no longer discounts `weighted_total` at all.** A bench/trial raider's score is `raw_score * role_mult` (plus the existing item-ownership and wishlist multipliers), identical math to a full-status raider. Officers now see a trial/bench raider's real weighted score; status only changes which tier they sort into. This removed the old `BENCH_ROLE_MULTIPLIER`/`TRIAL_ROLE_MULTIPLIER`/flat bench/trial constants entirely -- one less set of magic numbers to retune later.
- Implemented in `20260801032445_priority_tier_bench_trial.sql`, replacing `generate_priority_order()` from `20260710130000_priority_generator.sql`/`20260720165552_priority_wishlist_ranking.sql`. No RLS or schema change -- function body only.

## 2026-07-30 -- Guild Officer access tier (#607): standalone grant (`guild_officers`), full on players/attendance/bios, view-only elsewhere, approvals/settings/priority-gen/loot-import stay blocked

Implements [#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607): elevated (not full) cross-team access for people with genuine guild-wide authority -- e.g. a Guild Master who raids on one team but isn't part of that team's own officer/team_leader roster and may still need to step in and resolve issues on any team.

- **Standalone grant, not derived from `team_members.role`.** Considered and rejected: "anyone who is `officer`/`team_leader` on at least one team also gets this on every other team." That doesn't cover the actual motivating case -- a Guild Master with no team-officer role anywhere still needs the access, and conversely a team's own officer shouldn't automatically get elevated rights on every other team just by virtue of running their own roster. Went with a new `guild_officers(id, discord_id, auth_user_id)` table instead, structurally identical to `site_admins` and managed the same way (grant/revoke by Discord ID from `admin.html`'s new Guild Officers tab, `is_site_admin()`-gated).
- **New `is_guild_officer()`**, guild-wide, no `team_id` param, mirroring `is_site_admin()` exactly -- a fifth, orthogonal tier alongside the [#294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294) vocabulary (raider/officer/team_leader/site_admin), not a value squeezed into `team_members.role`.
- **Full access** (OR'd into existing officer-write policies, plus `write_audit_log()` so those writes' self-logging doesn't fail): `players`, `attendance`. Also `set_guild_officer_bios()` -- a deliberate reversal of the 2026-07-26 decision that only `is_site_admin()` should write guild-wide bios. That reasoning was specifically about a _single team's own_ leader having no natural authority over guild-wide content; a guild officer, by definition here, represents genuine cross-team leadership, so the exclusion doesn't apply to this new tier.
- **View-only**: `audit_log` SELECT gets `OR is_guild_officer()`, same for `team_members` SELECT (the Roster tab's Discord Claims panel reads it). The four officer report views and `priority_order` SELECT needed **no RLS change at all** -- both were already public-read/cross-team-readable; the view-only requirement for those was purely a frontend gating problem (hide the edit/regenerate controls), not a database one.
- **Deliberately excluded, no RLS change**: `bis_requests`, `mplus_exclusion_requests`, `season_signups`, `self_received_requests` (approvals), `team_settings` (season settings), `priority_order` write policy (generation/editing), `rclc_loot` write policy (loot import), `team_members` write policy. `is_guild_officer()` is never OR'd into any of these -- a guild-officer-only caller is denied by RLS exactly like a raider, independent of whatever the frontend renders.

## 2026-07-29 -- `items.main_stats`: array, spec-scoped filtering, Trinket/Weapon/Off Hand only

Decided directly in conversation (no tracking issue): filter Wishlist/BiS-grid Trinket/Weapon/Off Hand rows by whether the raider's spec can use the item's main stat, same as `items.armor_type` already gates the armor rows.

- **Array, not a single value** -- nullable jsonb, e.g. `["AGILITY","INTELLECT"]`, mirroring `secondary_stats`'s shape/semantics (`null` = not yet backfilled, `[]` = confirmed stat-less/universal). Necessary because this expansion's itemization lets one item roll several usable main stats at once (e.g. a Mail shoulder both a Hunter and an Elemental Shaman can use).
- **Backfilled by `scripts/fetch-item-stats.js`** (extended, not a new script) -- Blizzard's `preview_item.stats[].type.type` already yields clean `STRENGTH`/`AGILITY`/`INTELLECT` values; the Wowhead PTR fallback needed a second parsing path since Wowhead marks primary stats with numeric comment codes (`<!--stat5-->` etc), not the plain-text stat names secondary stats use.
- **Falls back to the item's Equip:/Use: effect text when there's no raw stat entry at all** -- many raid trinkets (procs/on-use effects) carry their stat restriction only in the effect description (e.g. Hex Lord's Dooming Idol drains/restores Intellect via its proc, with no stat line on the tooltip). Blizzard consistently names the exact stat(s) in that text when a trinket is genuinely restricted, and uses generic phrasing or lists all three when a trinket is meant to be universal -- confirmed empirically against several current-tier trinkets, so this only ever narrows `main_stats`, never over-filters a universal proc.
- **Filter scoped to Trinket 1/2, Weapon, Off Hand only** -- Neck/Back/Wrist/Finger never roll a main stat in this expansion's itemization, so they're intentionally left unfiltered rather than gated on data that will always be absent.
- **Keyed by spec, not class, for the lookup** -- `specMainStat(class, spec)` in `js/common.js`, not a flat `spec -> stat` map -- because Death Knight's "Frost" spec (Strength) and Mage's "Frost" spec (Intellect) are the same string with different meanings. Druid/Monk/Paladin/Shaman (main stat varies across all their specs) and Demon Hunter's Devourer tank spec (Intellect, unlike Havoc/Vengeance's Agility) get per-spec overrides; every other class/spec resolves from a flat per-class stat.

## 2026-07-26 -- `players.is_backup_tank`/`is_backup_healer`: independent, non-exclusive, always-on flags

Decided directly in conversation (no tracking issue): a way for officers to mark designated backup tanks/healers on the roster.

- **Multiple raiders can hold either designation at once** -- no single-holder exclusivity, no auto-clearing a previous holder. Same shape as `is_trial`/`is_bench`: independent booleans, no cross-player bookkeeping.
- **Not restricted to a player's current role** -- a Melee DPS with a tank offspec can be flagged Backup Tank. The columns carry no role check, client or server side.
- **Always available, no feature flag** -- unlike Bench (gated by `featureEnabled('bench')`), every team gets both toggles unconditionally.
- **Public badge, same visibility as Trial/Bench** -- shown on the profile page (shared by index.html and officer.html's inline render) and as a status tag in the officer roster table. Not shown on the public roster table, since Trial/Bench aren't either.
- **Threaded through `add_signup_to_roster()` at promotion time**, not stored on `season_signups` -- same pattern `is_trial` already uses, since there's nothing on a signup itself to derive a backup-role designation from (no smart default, unlike Trial's "new character, not a main-swap" heuristic).
- **Adding the two trailing parameters produced a second, distinct function overload** rather than replacing `add_signup_to_roster()` in place -- confirmed against a local `db reset`, which left the old 3-arg and new 5-arg signatures both callable. The migration explicitly drops the old overload and re-grants the new one (`authenticated` only, revoked from `anon`/`public`) rather than relying on `CREATE OR REPLACE` to carry grants forward, since a genuinely new function doesn't inherit them and Postgres grants EXECUTE to `PUBLIC` by default.

---

## 2026-07-26 -- Guild Officer Bios move to `site_settings`, gated by `is_site_admin()`

Decided directly in conversation (no tracking issue): Guild Officer Bios (#577/#586) had been stored in `team_settings.config.guildOfficerBios`, which is scoped per team_id -- a bio saved on one team's site never showed up on another's, even though the guild's officers are the same people regardless of which team's site you're viewing.

- **Moved to `site_settings.guild_officer_bios`** (a new jsonb column on the existing guild-wide singleton table added for maintenance mode, #245) -- same shape/RLS/public-read pattern as `maintenance_mode`, no new table, no new RLS policy needed (the table's existing "Public read site_settings" `using (true)` policy and base grant already cover it).
- **Write access gated by `is_site_admin()`**, not `my_team_role(team_id) = 'team_leader'` -- a team's own leader has no natural authority over guild-wide content. New `set_guild_officer_bios()` RPC mirrors `admin_set_maintenance_mode()`'s shape exactly (`SECURITY DEFINER`, `is_site_admin()` check, its own `write_audit_log()` call).
- The officer editor (`officer.html`'s Bios tab) still shows the current Guild bios to any officer, read-only, with the add/save/reorder controls disabled and a note shown when the logged-in user isn't a site admin -- rather than hiding the section outright, so a non-admin officer can still see who's listed.
- Existing data backfilled from whichever team had a non-empty `guildOfficerBios` (only one did), then that now-dead key stripped from every team's `team_settings.config`.

---

## 2026-07-25 -- `incoming_roster` view exposes `swap_from_name_realm`

Decided directly in conversation (no tracking issue) while building the signup-time "who else already plays this class" feature: a returning roster member who submits a genuine main-swap to a _different_ character name would otherwise show up twice in that comparison -- once under their current roster character, once under the new incoming one -- since the client had no way to know one supersedes the other.

- **Added `s.swap_from_name_realm` to the `incoming_roster` view's column list** (appended at the end, not inserted mid-list -- `CREATE OR REPLACE VIEW` can only add trailing columns without erroring). Not a security change: character names are already public everywhere else in this app (roster, bios, loot log); the view's existing officer-only boundary (`player_note`, `signup_officer_note`, `reviewed_at`, `reviewed_by`, `off_specs`, `main_swap`, `submitted_at`) is unchanged.
- Client-side (`js/signup.js`'s `signupClassmatesPool()`), an incoming row's `swapFromNameRealm` now excludes that name+realm from the roster half of the comparison pool entirely, rather than showing both. A same-name resubmission (no real swap, just resigning under the same character) is handled separately by de-duping on name+realm, keeping the incoming entry.
- Migration (`20260726104522_incoming_roster_swap_from_name_realm.sql`) had to sort _after_ `20260726104514_incoming_roster_public_view.sql` (the view's actual `CREATE VIEW`) -- a real ordering conflict, not just cosmetic drift, since a plain `CREATE VIEW` errors if the view already exists.

---

## 2026-07-23 -- Un-bundles signups from `seasonView` (#549 correction): `signupSeason` keeps its own independent setting

Surfaced during implementation, before #549 shipped: bundling `signupSeason` into `seasonView` (the 2026-07-22 entry below) assumed the two concepts move on the same timeline. They don't. Signups for the next tier routinely open while the current tier is still being raided -- that overlap is the normal case, not an edge case -- but item/BiS/Wishlist scoping is about what raiders should see for tonight's raid. Pointing `seasonView` at the next season to open its signups would have also flipped every raider's Priority tab/BiS grid/Wishlist to that next season's (probably still-incomplete) item catalog mid-raid.

- **`signupSeason` (`team_settings.config.activeSignupSeason`) is un-retired.** Signups keep their own independent free-typed setting, exactly as before #549 touched it -- separate Season Settings card, separate save path, separate RPC/view reads (`submit_season_signup`, `get_own_signup`, `incoming_roster`). None of the DB objects `activeSignupSeason` already touched needed changing; the migration proposed in the original #549 work was never applied to production and was reverted before merge.
- **`seasonView` keeps its full original scope for item/BiS/Wishlist**: the `raid_zones`-sourced dropdown, `isItemInSeasonScope()`/`currentZoneIdsForSeason()` reading `DATA.raidZones` instead of `DATA.raidProgression`, and the four "Show all seasons" checkboxes' retirement all stand as decided in the entry below. Only the "signups read/write `seasonView` directly" clause is reversed.
- **The two settings are allowed to diverge on purpose.** An officer can have `seasonView` unset (raiders see the live season's items) while `signupSeason` already points at the next tier (new recruits get tagged correctly) -- that's the actual intended workflow, not a state to guard against.

[Full discussion -> #549](https://github.com/katogaming88/WGA-Raid-Hub/issues/549)

---

## 2026-07-22 -- Unified `seasonView` setting (#549): replaces `raidProgression`-based item scoping, `signupSeason`, and "Show all seasons"

Surfaced while importing Season 2 (The Venomous Abyss) items ahead of actually switching the team over to it: #535 shipped item-catalog season scoping reading `DATA.raidProgression`, but `raidProgression` is really WCL progress-tracking config (which raids to pull kill/attendance data for), not a good source for "which season's loot to show." There was no way to prep Season 2's item catalog/wishlist/signups while Season 1 was still the live, actively-tracked season without either editing the live `raidProgression` (reshaping what raiders see immediately) or relying on the "Show all seasons" checkbox (shows everything unfiltered, not a specific season). Separately, `signupSeason` (`team_settings.config.activeSignupSeason`) already solved a version of this same problem for signups alone -- a real precedent for "a season you're actively managing, separate from the live raiding season," just reinvented ad hoc and shared with nothing else.

- **A single `team_settings.config.seasonView`, nullable.** Empty/unset resolves to "whichever season is live" (`DATA.seasonName`) -- today's default behavior for everything. Explicit values come from **`raid_zones.season`** (distinct values, e.g. `"Midnight Season 2"`), not a free-typed field and not the JS-constant mechanism #537 proposed (see below) -- `raid_zones` is already the authoritative `wcl_zone_id <-> season` mapping used for WCL progress tracking (#285), so making a season selectable is just adding its `raid_zones` row, a step already required for that tier eventually anyway.
- **One Season Settings dropdown** ("Season your team is planning"), not per-tab toggles.
- **Everything season-scoped reads `seasonView` instead of its own mechanism**: the Priority tab/BiS grid's `isItemInSeasonScope()`/`currentZoneIds()` (`raidProgression`-derived today, #535), the Wishlist's season filter, and `signupSeason` (retired as its own free-typed field -- signups read/write `seasonView` directly). The "Show all seasons" checkboxes are **retired entirely**, not kept alongside the picker -- auditing an old BiS entry means picking that old season by name from `seasonView`, not a separate blanket "show everything unfiltered" toggle.
- **`raidProgression`/`seasonName`/attendance/WCL progress tracking are untouched.** An officer can point `seasonView` at Season 2 to manage signups/wishlist/BiS-prep for it while Season 1 keeps raiding, tracking attendance, and pulling WCL data normally -- these are deliberately decoupled concepts now.
- **Fail-open only applies to the default (unset) case.** Unset resolves to the live season and fails open the way #535 does today (no season tag, or no `raid_zones` rows configured at all, still shows -- an incompletely-onboarded team isn't punished with an empty catalog). An **explicitly** set `seasonView` filters strictly: no `raid_zones` row for that season yet, or zero items/signups tagged to it, means an empty view, not a fallback to "show everything" or a silent default back to the live season. This doubles as the way to verify a new tier's import actually worked -- point `seasonView` at it and watch views go from empty to populated as the import completes.
- **Supersedes part of #537.** That decision's constant was meant to carry `wclZoneId` and "drive both this issue's auto-naming and #535's items/bosses season filter" -- wrong now that the filter reads `seasonView`/`raid_zones.season` instead of a JS constant. #537's actual scope (auto-generating `seasonName`/`signupSeason` display strings from a code+prefix pattern for the "New Season" button) is unaffected; only that one clause is corrected here rather than edited in place (matching how the #455 entry handled correcting stale references in older entries).

[Full discussion -> #549](https://github.com/katogaming88/WGA-Raid-Hub/issues/549)

---

## 2026-07-22 -- Scoping `items` by raid tier (#535): a global `wcl_zone_id` column, not a per-team season label or a per-team override table

`items`/`item_bosses` have no season/tier concept at all -- every item ever imported sits in the same flat catalog forever, and the Priority tab, BiS grid, and Wishlist all list the entire unfiltered catalog. Confirmed while scoping a re-import for Season 2: nothing today would stop Season 1 bosses/items from showing up right alongside Season 2's once imported.

- **`items.wcl_zone_id`, not a free-text `items.season` column.** `items` has no `team_id` -- it's shared across all three teams (Phoenix, Hellfire, Immolation), while each team's own season name (`team_settings.config.seasonName`) is independently officer-typed and could label the same real raid tier differently between teams. A free-text season column on a _shared_ table risks showing/hiding the wrong items for one team. `wcl_zone_id` mirrors `raid_zones.wcl_zone_id` (#285) -- a stable, team-agnostic identifier tied to the actual game content.
- **No per-team override table.** A single global zone ID per item is enough, since the underlying game content is identical across teams -- only each team's _current_ zone selection differs, and that already lives in their own `team_settings.config.raidProgression`. "Current season" for filtering purposes is just whichever zone ID(s) appear in a team's own `raidProgression` right now, with no new season concept to introduce or keep in sync.
- **Filtered by default, with a "Show all seasons" toggle**, not fully hidden. Losing the ability to correct an old BiS entry or look something up during an audit was judged worse than the clutter this fixes.
- **Placeholder items (`M+`/`Crafted`/`Catalyst`) stay exempt from the filter** -- they aren't tied to a raid zone at all.
- **Rollout covers three places, not just the Priority tab that prompted this**: the Priority tab's item picker/boss filter/Unmanaged Items, the BiS 16-slot grid editor, and the raider Wishlist's per-slot item buckets. Officer loot import is unaffected either way since it matches pasted loot by item name, not a filtered list.

[Full discussion -> #535](https://github.com/katogaming88/WGA-Raid-Hub/issues/535)

---

## 2026-07-22 -- Season naming driven by a shared code constant, not free-typed per team (#537)

`seasonName`/`signupSeason`/`seasonCodePrefix`/`seasonDisplayPrefix` are all officer-typed free text stored independently per team in `team_settings.config`. All three teams raid the same real-world tier at once, but nothing enforces their season-name strings actually match -- and every downstream `season` column (`rclc_loot`, `priority_order`/scoring, `season_signups`) is a plain string-equality check against whatever got typed.

- **A single JS constant Kat updates once per real-world tier, not a DB reference table or a free-typed field.** Same manual-per-tier-edit workflow already used for `scripts/fetch-items.js`'s hardcoded zone ID -- every team's "New Season" button reads and applies the same value, so drift is structurally impossible rather than merely encouraged against. Deliberately not a DB table: avoids a new globally-shared table + RLS + admin UI for something that already has an equivalent manual-edit workflow elsewhere.
- **Shared with #535's per-item `wcl_zone_id`.** The same constant carries `{code, displayName, wclZoneId}` -- one per-tier update drives both this issue's auto-naming and #535's items/bosses season filter, instead of two per-tier configs that could themselves drift apart.
- **"New Season" combines archive + auto-name into one click**, replacing today's two-step "archive wipes the name -> officer retypes it" flow -- but still requires the same confirmation dialog as today's Archive button before it runs, since archiving stays a destructive, hard-to-reverse action regardless of how the new name gets filled in.
- **The generated name must still match the format the existing free-text `season` columns already compare against** (`seasonCodeForDisplay()`/`seasonDisplayName()` in `js/common.js`) -- this changes _where the value comes from_, not the string format those columns already expect.

[Full discussion -> #537](https://github.com/katogaming88/WGA-Raid-Hub/issues/537)

---

## 2026-08-03 -- Season code/display prefix hardcoded, no longer a per-team setting (#643)

`seasonCodePrefix`/`seasonDisplayPrefix` were an officer-editable per-team `team_settings.config` setting (#341), read at translation time by `_seasonCodePrefix()`/`_seasonDisplayPrefix()` in `js/common.js`. #537 already established that expansion boundaries require a manual code edit to `CURRENT_SEASON`, which made the per-team setting redundant with a step that already has to happen in code -- and, per #537's own decision log, a per-team value only risked two teams drifting to different prefixes for what's actually the same real-world expansion.

- **Now hardcoded constants** (`SEASON_CODE_PREFIX`/`SEASON_DISPLAY_PREFIX` in `js/common.js`), Kat-updated in the same commit as `CURRENT_SEASON` at an expansion boundary. Removed from `SEASON_CONFIG_KEYS` and the Season Settings UI entirely.
- **Verified no-op for existing data**: a read-only prod query confirmed no team had ever set a non-default value for either field, and every stored `seasonName` already matched the default `"Midnight Season N"` pattern -- no backfill/migration needed.
- **Season Name and Signup Season inputs simplified to a number** (`seasonNameInput`/`signupSeasonInput`, now `type="number"`) since the prefix is no longer officer-typed; `saveSeasonName()`/`saveSignupSeason()` compose the full name from the number + `SEASON_DISPLAY_PREFIX`. A capped dropdown (1/2/3) was considered and rejected -- season counts occasionally exceed 3 within an expansion, and a number input has no ceiling to maintain.
- **Follow-up filed separately, not addressed here**: #642, a "New Expansion" confirmation toggle on Start New Season as a safety net against forgetting to update `CURRENT_SEASON`/the prefix constants at the actual boundary.

[Full discussion -> #643](https://github.com/katogaming88/WGA-Raid-Hub/issues/643)

---

## 2026-07-16 -- Season signups now require a Discord login (reverses #403's anon-callable decision)

`submit_season_signup` was deliberately granted to `anon` in the 2026-07-10 entry below, for prospective recruits with no Discord session yet. That's reversed: every signup must now be tied to a real account, so an anonymous submitter has no way in.

- **`submit_season_signup` raises `Not signed in` when `auth.uid()` is null**, instead of opportunistically capturing `auth_user_id` only when present. `anon` loses execute on the function entirely; only `authenticated` can call it now (`20260716210158_submit_season_signup_require_auth.sql`).
- **Frontend gate matches the RPC gate**: `js/signup.js`'s `showSignupView()` renders a "You must sign in with Discord to do this" message with a login button in place of the step-1 form when there's no Discord session, rather than hiding the "Sign Up" nav item. The RPC check is the real guarantee; the frontend message just avoids a raider filling out four steps before hitting a wall.
- **Logging in still doesn't require a claimed character.** A raider can sign in with Discord and sign up with no character claimed at all -- claiming only gates the main-swap option (a swap must be tied to a claimed character to auto-fill "switching from", same PR), not the ability to sign up.

[Full discussion -> #513](https://github.com/katogaming88/WGA-Raid-Hub/issues/513)

---

## 2026-07-13 -- twitch-live-check / wcl-progression-sync (#493): pg_cron + pg_net replaces GitHub Actions scheduling

Both Edge Functions were originally put on a GitHub Actions cron schedule because this project had no `pg_cron`/`pg_net` infrastructure at the time (#285, #286 -- see the 2026-07-12 entry below). In practice, GitHub Actions' scheduled-workflow trigger never actually honored either workflow's cron expression: checking `twitch-live-check.yml`'s run history, real gaps between runs were 1-3 hours the entire time, not the 5 minutes it was scheduled for. That's a real correctness gap, not just cosmetic drift -- the landing-page "who's live" banner/widget trusts `streamers.is_live`, and a raider going live could show as offline there for up to an hour. Confirmed directly: a raider was live and playable on the Streams tab (which embeds Twitch directly, no `is_live` dependency) while `is_live` was still `false` from a check taken nearly an hour earlier.

- **`pg_cron` + `pg_net` enabled, calling both Edge Functions directly from Postgres** (`supabase/migrations/20260713234553_pg_cron_edge_function_scheduling.sql`), rather than switching to a different external cron service or making the landing-page UI tolerate staleness instead. Removes GitHub Actions' unreliable scheduling from the loop entirely for both functions.
- **Both workflows' `schedule:` trigger removed, `workflow_dispatch` kept** as a manual fallback/debug trigger -- pg_cron now owns the cadence for both.
- **`wcl-progression-sync` moved to pg_cron in the same migration**, on the assumption it has the same reliability gap, even though no missed scheduled run was directly observed for it -- its only invocations so far have been manual `workflow_dispatch` runs, so there's no scheduled-run history to check against.
- **Shared secrets stored in Supabase Vault** (`vault.create_secret`), not inlined in the migration -- the migration only schedules the cron jobs assuming `twitch_live_check_secret` / `wcl_progress_sync_secret` already exist in Vault, reusing the same values already set as GitHub Actions repo secrets and Edge Function secrets.

[Full discussion -> #493](https://github.com/katogaming88/WGA-Raid-Hub/issues/493)

---

## 2026-07-12 -- Mythic pull count/best % progression (#285): normalized WCL reference tables + a GitHub Actions cron, not a JSON blob or a manual-only refresh

Landing-page ask: show live pull count/best % on the current work-in-progress mythic boss, and total pulls on already-killed bosses, matching WCL's own reports view. `team_settings.config.raidProgression` already holds an officer-curated raid/boss list (Season Settings' "Refresh from WCL" button), but that list only stores `{name, mythicDate}` per boss -- no WCL encounter ID -- and only updates when an officer manually clicks refresh.

- **New `raid_zones`/`raid_encounters` tables, not reusing the config JSON.** Same category as `items`/`classes_specs`: shared reference data, public read, no authenticated write policy (only a service-role sync or manual SQL Editor edit ever touches them). `team_raid_progress` is the per-team row, one per encounter, upserted by the sync.
- **The sync re-queries WCL's `zone(id).encounters` every run rather than trusting `config.raidProgression`'s boss list for encounter IDs**, since `tab-season.js`'s `fetchWclForRaid()` discards the ID WCL returns before saving. The landing page's render side has the same gap -- it joins `DATA.raidProgress` to a boss by `(wclZoneId, normalised boss name)`, not encounter ID, since that's the only key `config.raidProgression` actually carries client-side.
- **A new `wcl-progression-sync` Edge Function on a GitHub Actions cron, not `wcl-sync` or a manual button.** `wcl-sync`'s existing actions all forward a real officer's JWT and are gated by `my_team_role()`; there's no logged-in officer for a scheduled job, so this new function uses the service-role key + a shared `x-cron-secret` header, mirroring `twitch-live-check` (chosen there because no `pg_cron`/`pg_net` infrastructure exists in this project's Supabase instance).
- **Cadence: every 30 minutes, but only Tue/Thu/Mon 9:30pm-midnight Eastern** (Kat's actual raid nights, Monday being the standing makeup/extra-day slot) -- pull counts only change during raid nights, so polling the rest of the week would just waste WCL API calls for no fresher data. GitHub Actions cron is UTC-only with no DST awareness, so the schedule is padded an hour on each side to cover both US DST offsets without a biannual manual edit (see `.github/workflows/wcl-progression-sync.yml`'s header comment for the exact UTC math).
- **`team_raid_progress` still gets an officer/team-leader write policy** even though the sync is the only writer today, matching the `streamers`/`player_wcl_season_perf` pattern of leaving a manual-correction path open.

[Full discussion -> #285](https://github.com/katogaming88/WGA-Raid-Hub/issues/285)

---

## 2026-07-11 -- Danger Zone request-table clears (#225): five single-purpose RPCs, not one generic one; loot stays a direct delete

The Danger Zone's seven "Clear ___ Sheet" ops were the last GAS call sites left standing once #386/#423/#453/#455 finished migrating everything else -- retiring Apps Script (#225) meant finally giving them a real destination instead of a dead GAS action.

- **Five separate `danger_clear_*` functions, not one function parameterized by table name.** Every other request-table write in this schema (`submit_self_received`, `direct_mark_received`, `set_team_setting`, etc.) is single-purpose SECURITY DEFINER, and a table-name-as-parameter design would mean building a `delete from` statement dynamically -- avoidable SQL-injection-adjacent surface for a feature that only ever needed five fixed targets.
- **All five are `is_site_admin()`-only, not `my_team_role() OR is_site_admin()`.** None of the underlying `DANGER_OPS` entries carry `teamLeader: true` except Clear Season History (the #294 decision), so these five stay narrower than the officer-or-site-admin shape `direct_mark_received()` uses.
- **`danger_clear_pending_roster` is a distinct, narrower op from `danger_clear_season_signups`.** The old GAS "Pending Roster" sheet was specifically the queue of approved-but-not-yet-added signups, not every signup ever submitted -- matched here to the `pending_roster` view's own definition (`status = 'approved' and approved_player_id is null`) rather than reusing the full-clear RPC with a filter flag, so the two operations can't be confused by a caller passing the wrong argument.
- **`rclc_loot` ("Clear Loot Data") gets no RPC at all.** Officers already hold a direct `ALL` grant on it for their own team (the same grant the loot-import path uses), so a Danger Zone SECURITY DEFINER wrapper would be narrowing access that already exists, not widening it. Stays a plain client-side delete.
- **"Clear Pasted Loot Sheet" is retired outright, not migrated.** #219 replaced the old paste-to-sheet-then-import flow with a direct paste-to-RPC import (`import_rclc_loot()`) that writes straight to `rclc_loot` with no staging table, so the sheet this op used to clear has had no Supabase-side equivalent since #219 shipped.

[Full discussion -> #225](https://github.com/katogaming88/WGA-Raid-Hub/issues/225)

---

## 2026-07-11 -- Dropped season_snapshots (#455): designed to replace the season history blob, never actually used

Surfaced while fixing #423 (Danger Zone's Clear Season History op described itself as clearing this table -- it never did). `season_snapshots` (`team_id`, `season`, `snapped_at`, `data jsonb`) was designed in the original migration plan (`docs/supabase-migration-plan.md`) to hold one row per archived season per team, explicitly called out as replacing "the season history blob" from the GAS Script Properties era.

- **What actually shipped instead:** #221 (PR #401) built the real archive/unarchive feature against `team_settings.config.seasonHistory` -- an array inside the general-purpose settings JSON blob -- rather than a `season_snapshots` row. That decision was never written down anywhere; it reads as an oversight, not a reconsideration. The table shipped with correct RLS from day one (team-leader write, per the #294 decision) and stayed accurately documented through several later RLS audits, but nothing in `js/` ever read or wrote it.
- **Verified dead before dropping:** 0 rows on both live teams, zero references anywhere in `js/`, zero foreign keys from any other table. The drop migration re-checks the row count at migration time rather than trusting that to still hold.
- **Not editing `docs/supabase-setup-guide.md`.** Rex owns later phases there per standing practice; this drop is noted for him separately rather than touched into the locked file.
- **Existing decision-log entries mentioning `season_snapshots`** (RLS policy history, e.g. the #413 and #294 entries below) are left as-is -- they're accurate records of decisions made about the table while it existed, not claims that it's still in use.

[Full discussion -> #455](https://github.com/katogaming88/WGA-Raid-Hub/issues/455)

---

## 2026-07-11 -- Item catalog slot vocabulary (#453): re-derived from Wowhead, not translated; duplicates deleted, not merged

`items.slot` held a vocabulary hand-typed into the retired GAS "Item Lookup" spreadsheet (`Boots`, `Gloves`, `Belt`, `Bracers`, `Cloak`, `Shoulders`, `Ring`, `1H/2H`, `OH`, `Unknown`). The game, Wowhead, `scripts/fetch-items.js`, and `bis_items.slot` all say `Feet`, `Hands`, `Waist`, `Wrist`, `Back`, `Shoulder`, `Finger`, and split weapons into `One-Hand`/`Two-Hand`/`Ranged` -- so the catalog was the only thing out of step, and every consumer carried a synonym table to bridge it. Surfaced while building #386, where the display slot and `bis_items.slot` diverging nearly shipped a silent no-op.

- **Slots re-derived from Wowhead by `wow_item_id` (the `&xml` endpoint's `<inventorySlot>`), not string-translated from the old words.** A mapping table cannot split `1H/2H` into One-Hand (12 items) / Two-Hand (5) / Ranged (2), and cannot recover `Unknown` (19 items) at all -- together ~30% of the catalog. Every item carries a `wow_item_id`, so the authoritative source was available and guessing was unnecessary.
- **The type-vs-position split is kept, because it is irreducible.** `items.slot` is an equip _type_ (a ring fits either finger; Wowhead returns `Finger`, i.e. Blizzard's `InventoryType`), while `bis_items.slot` is a _position_ (`Finger 1`). Only the officer's BiS assignment can say which, so `BIS_CATALOG_SLOT_TO_ROWS` still fans `Finger`/`Trinket` out to both numbered rows. This mirrors how the game models it (`INVTYPE_*` vs `INVSLOT_*`) and how the RCLootCouncil addon already does (`INVTYPE_FINGER = { "ring1", "ring2" }`).
- **19 duplicate rows deleted rather than merged, and a unique index added on `wow_item_id`.** The catalog held 132 rows for 113 distinct items -- every tier token existed twice, once hand-filed with a slot and once seeded bare as `Unknown`. They evaded `unique(lower(name))` because the hand-filed rows carry an armor-type suffix (`Alnforged Riftbloom (Plate)`) and the seeded ones do not; nothing enforced uniqueness on `wow_item_id`. Confirmed against the live database that no `bis_items`, `rclc_loot`, `priority_order`, `self_received_requests` or `item_bosses` row referenced a duplicate, and that all 19 survivors kept their boss mapping -- so a delete was safe and a merge unnecessary. The migration guards this rather than trusting it: it raises if any reference exists at run time.
- **Armor type dropped from tier-token names.** `Alnforged Riftbloom (Plate)` -> `Alnforged Riftbloom`; `items.armor_type` already stores `Plate`. The suffix was how the spreadsheet told four identically-named tokens apart, which the column now does. Only a suffix literally repeating `armor_type` is stripped, so `Chiming Void Curio (Tier)` -- a class-set trade token with no armor type -- is left alone. This has to run _after_ the dedupe, since the bare names were exactly what the duplicate rows occupied.
- **`Curio` and `Placeholder` map to no BiS row on purpose.** The one Curio is a class-set trade token ("trade this for powerful class set armor"), and the placeholders (M+/Crafted/Catalyst) name a loot source. Neither names a gear position, so neither is exportable as a BiS slot.
- **Noted, not done: keying slots by the game's numeric `InventoryType`/`INVSLOT` id** with a reference table, which would buy FK integrity (`Trinket 3` becomes unstorable) and a natural sort order. Not needed to fix the above -- once the names are normalized they already agree -- so it stays a possible follow-up rather than scope here.

[Full discussion -> #453](https://github.com/katogaming88/WGA-Raid-Hub/issues/453)

---

## 2026-07-11 -- Self-received approval syncs bis_items.obtained (#386): a slot column plus a one-way trigger, not RPC-side writes

Approving a self-received item should tick the matching BiS row as obtained, so BiS Manager stays the one place officers actively _edit_ a list and "Mark received" is only a received-state signal (#217's stated intent). Three decisions fell out of it.

- **Added `self_received_requests.slot` (nullable text)** rather than matching on `(player_id, item_id)` alone. `bis_items` is unique on `(player_id, item_id, coalesce(slot, ''))`, and the placeholder items -- `M+`, `Crafted`, `Catalyst` (`items.is_placeholder`) -- name a loot _source_ rather than a piece of gear, so one player legitimately lists `M+` against six different slots (10 such rows live at the time of writing). An approved `M+` with no slot could not say which of those rows it filled; flipping all of them would fill six slots from one drop. The frontend already knew the answer (the "Mark received" button is rendered per BiS row) and simply had nowhere to put it.
- **The button sends the raw `bis_items.slot`, not the displayed slot name.** These diverge routinely -- the item catalog says `Boots`/`Gloves`/`Trinket` where `bis_items` says `Feet`/`Hands`/`Trinket 1` (and 30 live rows carry a blank BiS slot against a `Trinket` catalog slot). `mapSupabaseBisItems()` already exposed both as `entry.slot` (display) and `entry.dbSlot` (raw), for exactly this reason on the tab-bis.js delete/update path. Sending the display slot would have made the trigger match nothing for most real items -- a silent no-op, not an error.
- **The flip lives in a trigger on `self_received_requests`, not inside `submit_self_received()`/`direct_mark_received()`.** There is a third path to `approved` that is neither RPC: the officer Requests tab (`js/tabs/tab-requests.js`) approves a pending row with a plain `UPDATE`. A trigger catches all three (raider auto-approve, officer direct-mark, queue approval) and cannot be bypassed by a fourth. `SECURITY DEFINER`, since a raider auto-approving their own item is not an officer and writes to `bis_items` are restricted to officers.
- **One-way on purpose**: approving sets `obtained = true`; rejecting or reverting an approval never sets it back to `false`. An officer may have ticked the box by hand for an unrelated reason, and clearing it here would silently discard that. Unticking stays a deliberate officer action in BiS Manager.
- **Both RPCs were dropped and recreated, not `CREATE OR REPLACE`d.** A function is identified by `(name, argument types)`, so adding `p_slot` would have left the old 6-argument version in place as an overload that PostgREST could still resolve calls to.

[Full discussion -> #386](https://github.com/katogaming88/WGA-Raid-Hub/issues/386)

---

## 2026-07-10 -- Season-code to display-name mapping (#341): stays a frontend translation, now pattern-derived instead of hardcoded per season

`scoring.season`/`priority_order.season`/`rclc_loot.season` store a compact code (`MID1`, decided on #320) as the stable join/filter key across those tables, while officers see and type a free-text display name (`DATA.seasonName`, Season Settings tab -> `team_settings.config` via `saveTeamSetting()`, #221). Something has to translate between the two on every read/write that touches season data.

- **Kept as a frontend translation in `js/common.js`** (`seasonDisplayName()`/`seasonCodeForDisplay()`), rather than a dedicated `seasons` table or a `settings.config` key -- this was already the de facto mechanism since #209 (a single hardcoded `SEASON_LABELS` entry), just never formally decided.
- **Revised during the same PR from a hardcoded map to a pattern**: the first draft kept `SEASON_LABELS = { MID1: 'Midnight Season 1' }` as the permanent mechanism and documented a runbook ("add the next season's code here before officers start using it") -- flagged as insufficient before merge, since it required remembering a manual step at every season boundary with a silent failure mode if skipped (every `p_season`-resolving write would store the full display string instead of a short code). Replaced with a regex pattern (`'MID' + N` <-> `'Midnight Season ' + N`), so `MID2`, `MID3`, etc. translate automatically the moment they appear, no code change required. `SEASON_LABELS` is now empty by default and survives only as an explicit override for a season that breaks the pattern.
- **Revised again to make the prefixes themselves configurable**: `MID`/`Midnight Season` were still literal strings baked into the regex, so a future expansion (whose codes won't start with `MID`) would still need a code change. Moved them to `team_settings.config.seasonCodePrefix`/`seasonDisplayPrefix`, editable from a new "Season Code Prefix" field in Season Settings, defaulting to today's values when unset so no existing team needs a backfill. Flagged as an interim per-team setting: every team plays the same real-world expansion timeline, so this is really cross-team config that belongs on the site admin dashboard once #232 exists, not something each team's officers could independently drift on -- noted on #232 for when that lands.
- **No `data/seasons.json` involvement**: that file is an optional local input to the one-time legacy-loot-history import script (`scripts/import/generate.js`), not a repo-tracked or deployed artifact -- it doesn't intersect with this live-app translation at all.

[Full discussion -> #341](https://github.com/katogaming88/WGA-Raid-Hub/issues/341)

---

## 2026-07-10 -- players.officer_notes (#407): the column #407 assumed already existed had to be added

#407's premise -- "`players.officer_notes` already exists as a column in the schema but is never read or written anywhere in `js/`" -- was wrong. The column that actually exists is `mplus_exclusion_requests.officer_notes` (`initial_schema.sql`), a different table entirely; `dbdoc/public.players.md`'s relations diagram embeds that table's full column list next to `players`' own for the FK diagram, which is what got misread as a `players` column both when the issue was filed and when this fix's own PR first shipped without the column. Confirmed against the live database only after roster loads started failing with `column players.officer_notes does not exist`, well after the frontend write path (`renamePlayer`/`savePlayerNote`) had already been wired to it.

- **Plain `alter table ... add column officer_notes text`, no default, matching `m_plus_note`'s shape** -- an officer free-text field with no structural constraints of its own.
- **No RLS change**: `Officers write players` already grants UPDATE on the whole row to officer/team_leader; a new nullable column needs no new grant.
- **Takeaway for future request-table/column audits**: verify a claimed-existing column against the live database (or at minimum a full-text match on the exact table name in `dbdoc/schema.json`, not a substring/adjacent-context match) before writing the frontend side against it -- `dbdoc/`'s per-table relations diagrams intentionally embed related tables' columns for the ER diagram, which reads identically to that table's own column list at a skim.

[Full discussion -> #407](https://github.com/katogaming88/WGA-Raid-Hub/issues/407)

---

## 2026-07-10 -- Self-received request write path (#406): both submit and direct-mark go through SECURITY DEFINER RPCs, auto-approve now checks real Supabase Auth

`self_received_requests` fit the live feature exactly (`track`/`source`/`note` match `submitSelfReceivedRequest`'s payload one-to-one) -- it just never had an INSERT path or any frontend reference, matching #404/#405's finding for the other two request tables.

- **Two new RPCs, both SECURITY DEFINER: `submit_self_received()` (raider, granted to `anon`+`authenticated`) and `direct_mark_received()` (officer, granted to `authenticated` only).** Unlike `submit_bis_link()`/`submit_mplus_exclusion()`, the officer path here also needed a definer function rather than a plain RLS-gated insert -- `tests/rls/write-policies.test.js` already asserts request tables have no INSERT policy for anyone, officers included, so `direct_mark_received()` checks `my_team_role()`/`is_site_admin()` inside the function body instead.
- **Auto-approve now checks `auth.uid()` through `players.team_member_id -> team_members.auth_user_id`, replacing GAS's legacy Discord OAuth session-token check.** #222 already moved login itself onto Supabase Auth (`js/discord.js`'s `getDiscordSession()` wraps a real Supabase Auth session, not a GAS token), so "is the submitting raider signed in as this character" is a straight join instead of a client-supplied token GAS had to independently validate.
- **`DATA.selfReceived` (a player's approved self-received items, used for BiS-completion and profile badges) now reads from Supabase first, falling back to the Apps Script heavy chunk** -- same pattern as `bisList`/`priorityOrder` (#217, #220). Only `approved` rows are pulled; pending/rejected stay officer-queue-only.

[Full discussion -> #406](https://github.com/katogaming88/WGA-Raid-Hub/issues/406)

---

## 2026-07-10 -- Site-admin cross-team access on request tables (#413): four tables were missing OR is_site_admin()

While verifying #403's historical Hellfire signup backfill actually landed in production, the officer Signups History tab showed "No signups recorded" despite the data being confirmed correct via direct read-only access. Root cause: `my_team_role(team_id)` resolves per-team from `team_members`, and Kat's own account isn't a `team_members` row on Hellfire's team (a different Discord account holds team_leader there) -- so as far as RLS was concerned, the account had zero role on that team, same as any stranger.

That's expected behavior for a plain officer -- but Kat is also a site admin, and every other officer-scoped table already ORs in `is_site_admin()` so a site admin isn't limited to only the teams where they personally hold a `team_members` role (`audit_log`, `team_members`, `team_settings`, `season_snapshots`). Auditing every "Officers read/update" policy in the schema found four that never got this clause when `initial_schema.sql` created them: `season_signups`, `bis_requests`, `mplus_exclusion_requests`, `self_received_requests` -- all four "request" tables, all predating #403/#404/#405 (those PRs added RPCs/columns to three of them but never touched their read/update policies).

- **Added `OR is_site_admin()` to the read and update policies on all four tables**, matching the existing pattern exactly (`my_team_role(team_id) = ANY (ARRAY['officer','team_leader']) OR is_site_admin()`).
- **Updated `docs/RLS.md`'s per-table matrix and "Known issues" section**, which had also gone stale: it still said the write path for `season_signups`/`bis_requests`/`mplus_exclusion_requests` was "service-role only," true before #403-#405 but superseded once each got a narrow SECURITY DEFINER RPC. Those three PRs never triggered the "update RLS.md" CI check because none of them touched policy SQL -- only this PR's actual policy change did, which is exactly the gap that let the note go stale silently.
- **RLS test coverage added** (`tests/rls/read-matrix.test.js`, `write-policies.test.js`): site admin (a UID with no `team_members` row on either seeded team) can read all four tables and update at least one, proving the fix rather than just the policy text.

[Full discussion -> #413](https://github.com/katogaming88/WGA-Raid-Hub/issues/413)

---

## 2026-07-10 -- M+ exclusion write path (#405): approve now sets players.m_plus_excluded directly, rejection state derived live

Unlike `bis_requests` (#404), `mplus_exclusion_requests` already fit the live feature exactly (`reason`/`raiderio_url`/`status` match `submitMPlusExclusion`'s payload one-to-one) -- it just never got an INSERT path or any frontend reference. Confirmed 0 rows in production before writing this.

- **New `submit_mplus_exclusion()` RPC, SECURITY DEFINER, granted to `anon`** -- same trust model as `submit_bis_link()`/`submit_season_signup()`: the form runs unauthenticated on the public roster page. Re-validates `mPlusExclusionsOpen` server-side.
- **Approve now sets `players.m_plus_excluded`/`m_plus_note` directly, in the same officer action as marking the request approved.** GAS decoupled these: `approveMPlusExclusion` only ever updated the request's own status/note, and a _separate_ manual roster toggle (`setMPlusExcluded`, a Script Property array) was the only thing that actually excluded the player from weekly M+ requirements. That meant an approved request could sit approved indefinitely without the player ever actually being excluded, if the officer forgot the second step. Collapsing this into one write matches #404's BiS approve precedent (which also writes `players.bis_link` directly) and closes a real gap rather than just porting GAS's behavior faithfully.
- **`mPlusRejected`/`mPlusRejectionNote` are derived live from the most recent rejected request per player, not new `players` columns.** GAS tracked these via a Script-Property-backed scan of the whole exclusion sheet; `players` has no rejection-state columns, and adding one for what's fundamentally a request-table fact (was the raider's most recent submission turned down) would just duplicate state already in `mplus_exclusion_requests`. `fetchSupabaseMPlusRejections()` (`js/common.js`) queries the latest `rejected` row per `player_id` alongside the roster fetch and merges it in client-side.
- **Bulk "clear all" now just resets `players.m_plus_excluded = false` for the whole team**, with nothing else to reconcile -- GAS's version additionally flipped any `Approved` sheet rows to a `Reset` sentinel status so a later re-scan wouldn't double-count them; that bookkeeping only existed because the sheet itself was the source of truth for exclusion state. Since exclusion now lives solely on `players`, clearing it is the whole operation.

[Full discussion -> #405](https://github.com/katogaming88/WGA-Raid-Hub/issues/405)

---

## 2026-07-10 -- bis_requests repurposed for BiS link submissions (#404): dropped bis_req_item_id, gating moved to players.bis_allowed

`bis_requests` existed since `initial_schema.sql` with Officers read/update RLS already in place, but nothing ever wrote to it (confirmed 0 rows, 0 references in `js/`). Its shape -- `bis_req_item_id integer NOT NULL`, an FK to `items` -- couldn't hold what the live raider-facing feature actually submits: a whole BiS list URL (`js/common.js` `submitBiSForm` -> GAS `submitBiS`), one per player, unrelated to any single item. It looks like it was scaffolded generically alongside the other request tables (`self_received_requests`, `mplus_exclusion_requests`) assuming a per-item shape this feature never matched.

- **Repurposed the existing table rather than adding a second one**, since it was empty and unreferenced anywhere: dropped `bis_req_item_id`, added `bis_link text not null` and `player_note text`.
- **New `submit_bis_link()` RPC, SECURITY DEFINER, granted to `anon`** -- the submission form runs unauthenticated on the public roster page, same trust model as the GAS action it replaces. Re-validates the gate server-side (`team_settings.config.bisSubmissionsOpen` team-wide, or the player's own `bis_allowed`) rather than trusting the client's decision to show the form.
- **Per-player submission gating (`allowBisForPlayer`/`revokeBisForPlayer`) moved to a `players.bis_allowed` boolean column, not `team_settings`.** GAS stored this as a Script Property array toggled by any officer, no role distinction. The natural Supabase home for team-wide config, `set_team_setting()` (#221), is gated by "Team leaders write settings" -- routing a per-player toggle through it would have tightened today's any-officer access down to team_leader/site_admin only. A column on `players` keeps it on that table's existing officer-write rule instead (already officer _and_ team_leader), so the toggle stays exactly as accessible as it is today, with no new RPC.
- **Officer approve/reject and manual link edits write `bis_requests`/`players` directly** (two separate calls, not one transaction) -- both tables already have officer-write RLS, matching the direct-write pattern `js/tabs/tab-roster.js` already uses elsewhere. A failure between the two calls just leaves the request pending for a retry, no partial state an officer could act on incorrectly.

[Full discussion -> #404](https://github.com/katogaming88/WGA-Raid-Hub/issues/404)

---

## 2026-07-10 -- season_signups write path (#403): SECURITY DEFINER RPC granted to anon, no anti-spam token yet

`season_signups` had no INSERT path of any kind -- only officer read/update -- because the public signup form (`js/signup.js`) still wrote exclusively to the GAS "Roster Responses" Sheet, which the officer Signups/Pending Roster tabs stopped reading when they switched to Supabase-only reads in #328. Every real signup submitted since then landed somewhere no officer screen ever reads.

- **New `submit_season_signup()` RPC, SECURITY DEFINER, granted to `anon` (and `authenticated`)** -- unlike `claim_character()` (#212), which requires `auth.uid()`, this form runs for prospective recruits with no Discord session at all, so `anon` must be able to call it directly. It checks `team_settings.config.signupsOpen` server-side (the form's client-side gate was cosmetic only) and resolves `class_spec_id`/`swap_class_spec_id` from class/spec text itself, forcing `status = 'pending'`. `season_signups` still grants `anon` no direct table INSERT -- this function is the only write path.
- **No anti-spam token for v1.** #328's original out-of-scope note wanted an Edge Function with a spam token; Edge Functions are Phase 7 and don't exist yet. The `signupsOpen` server-side check alone is already strictly tighter than the status quo (GAS's `submitSignup` had no server-side gate at all), so shipping the RPC now without a token is not a regression. A token or the Edge Function replacement can be added later without a breaking change to the form's payload shape.
- **The free-text Discord Name field is dropped from the form**, per the #340 decision: the verified Discord link lives on `team_members` via the Claims flow now, and the typed handle predates that.
- **The GAS `submitSignup` call stays in place, called after the Supabase write succeeds**, solely for its Discord bot notification side effect -- #224 owns moving that notification to an Edge Function. No GAS code changed in this PR.
- **One-time historical backfill**: Hellfire's GAS sheet held ~21 real MID2 signups (Phoenix's sheet only had 2 June test rows, skipped). Cross-referenced against the live `players` table for team 2 to resolve each row's status: already-rostered names became `status = 'added'` with `approved_player_id` set (settled history, not a live queue item); the sheet's one `Denied` row became `rejected`; two names with no roster match and no denial (`Dhbruh-Dalaran`, flagged during the audit that opened #403, and `Poplockndots-Thrall`, found during this backfill) became `status = 'approved'` with `approved_player_id` left null, surfacing them in Pending Roster for an officer to actually decide on rather than leaving them invisible.

[Full discussion -> #403](https://github.com/katogaming88/WGA-Raid-Hub/issues/403)

---

## 2026-07-10 -- bis_items.slot (#393): officer-chosen slot for placeholder entries

Placeholder BiS entries (M+, Crafted, Catalyst) were displaying the literal word "Placeholder" as their slot -- `items.slot` is `NOT NULL`, and those rows store that sentinel since they name a loot source, not a gear slot. The old GAS BiS List sheet carried the real slot per-row instead (a player wrote "M+" into whichever slot's row they meant); that context was discarded at the #217/#320 migration, when `bis_items` collapsed to `(player_id, item_id)` with no home for it -- a known, documented, unrecoverable loss (`scripts/import/tables/bis.js`), same acceptance as the audit_log TARGET backfill (#377).

- **Added `bis_items.slot text`, nullable.** Originally scoped to placeholder rows only, but extended same-day once the editor moved to a fixed slot grid (below): "Finger"/"Trinket" alone can't say which of the two numbered rows a _real_ ring or trinket is for either, so every row the editor writes now carries an explicit `slot`, not just placeholder rows. Stays null only for legacy rows written before this column existed.
- **`bis_items_no_dupe_item_key` changed from `UNIQUE (player_id, item_id)` to a `UNIQUE (player_id, item_id, coalesce(slot, ''))` expression index**, so the same item (placeholder or real) can be aimed at two different slots for one player (e.g. both Finger slots at "M+", or two different rings each explicitly slotted). Legacy rows with `slot` still null keep deduping exactly as before, since `coalesce(slot, '')` collapses them all to `''`.
- **Frontend:** the BiS Manager editor became a fixed 16-slot grid (`BIS_SLOTS`, `js/tabs/tab-bis.js`) instead of a flat search-then-add list -- every row an officer fills writes its canonical slot to `bis_items.slot`, and the grid's per-row search is scoped to items whose catalog slot fits that row (`BIS_CATALOG_SLOT_TO_ROWS`), with M+/Crafted/Catalyst placeholders always offered everywhere. Delete/toggle-obtained now filter on `slot` too (`.eq('slot', ...)` / `.is('slot', null)`), since `item_id` alone no longer uniquely targets a row once more than one can share it.

[Full discussion -> #393](https://github.com/katogaming88/WGA-Raid-Hub/issues/393)

---

## 2026-07-09 -- Discord Claims display name (#389): new function, not a reuse of resolve_actor_name()

The Roster tab's Discord Claims list only ever showed the raw Discord snowflake id, making it hard for an officer to visually confirm the right account claimed the right character. `resolve_actor_name()` (#376) already resolves an actor uuid to a display name, but for a different purpose (the audit log's CHANGED BY column) with a resolution order that's wrong here: linked-character nickname/name first, Discord display name only as a last resort for a site admin acting cross-team.

- **New `resolve_discord_display_name(p_actor_id uuid, p_team_id integer)` function** instead of adding a mode flag to `resolve_actor_name()`. The claims-verification use case specifically wants the raw Discord display name every time, not the identity resolveAuditName prioritizes -- showing a claimed character's own nickname back as "the Discord name" would defeat the purpose (confirming the human behind the claim, not the character).
- **Same SECURITY DEFINER shape and gate** as `resolve_actor_name()`/`write_audit_log()`: officer/team_leader-or-site-admin on the team, since it's still surfacing `auth.users` PII not exposed to anon/authenticated directly.
- **Resolved client-side per claim, not joined in the query** -- `fetchTeamClaims()` (`js/discord.js`) only calls it for rows with a non-null `auth_user_id` (a pre-listed officer awaiting their first login has none yet), since a SECURITY DEFINER function can't be embedded in a PostgREST select the way a foreign-key join can.

[Full discussion -> #389](https://github.com/katogaming88/WGA-Raid-Hub/issues/389)

---

## 2026-07-09 -- RCLC loot import (#219): SECURITY INVOKER RPC, instance-suffix track, boss/itemID read straight off the export

The GAS paste-import only ever carried `id, player, date, itemName, instance` into the "Pasted Loot" sheet -- no difficulty, boss, or item-id derivation existed anywhere in the import path. Migrating this needed real new logic, not a straight port, and a sample live RCLC JSON export (provided by Kat) settled several things the issue itself had flagged as open:

- **Boss is directly in the export** (`"boss":"Chimaerus the Undreamt God"`) -- no `item_bosses` lookup needed at all, despite the issue's implementation steps suggesting one. `item_bosses` is many-to-many (`(item_id, boss)` composite PK, an item can drop from several bosses), so a lookup-based resolution would have been ambiguous anyway; the export already answers the question directly per row.
- **Item resolved by `itemID` (wow_item_id) first, name as fallback** -- the export's `itemID` field matches `items.wow_item_id` unambiguously, more reliable than name matching (special characters, renames). Mirrors the historical import's `itemIdByWowId` pattern for the legacy tracker source.
- **Track derived from the `instance` string's difficulty suffix only** (`"The Dreamrift-Mythic"` -> `Myth`), the same `parseTrack()` logic the one-time historical import already proved out. The export's `itemString` does technically encode the authoritative track via Blizzard bonus IDs, but decoding those needs a maintained bonus-ID reference table this repo doesn't have -- deferred as a documented future enhancement, not attempted now. Confirmed with Kat rather than half-implementing a guess.
- **"Source" is moot** -- `rclc_loot` has no column for it; the concept only applies to a different table (`self_received_requests`). What Kat actually wanted noted as "from the RCLC import" lives in the audit log action name (`'Loot Imported (RCLC)'`), not a data column.
- **Unresolved items are left `item_id = null` and counted, not auto-created.** Auto-creating a placeholder `items` row (matching the historical import's legacy-source behavior) would require `SECURITY DEFINER`, since `items` grants no authenticated role a direct write. Given the season's Item Lookup should already be populated before loot starts flowing, a genuinely unresolved item is a sign that needs updating, not something to paper over -- so the RPC stays `SECURITY INVOKER` instead, matching `add_signup_to_roster()`'s reasoning ("authorization comes from existing RLS") since officers already have full write access to both `players` and `rclc_loot` directly.
- **Player resolution is an exact `name_realm` match (case-insensitive), no diacritic folding**, unlike the Node-side one-time-import registry (`scripts/import/lib/registry.js`), which folds diacritics because sheet data was officer-typed by hand across multiple tabs inconsistently. RCLC reads the name straight from the game client, so it should already match the roster's `name_realm` exactly. Unknown names get an archived stub, same shape as the historical import's stub rows.
- **`awarded_at` combines the export's separate `date` and `time` fields** (assumed America/New_York, matching the site's existing display-timezone assumption for this data), an improvement over the GAS path, which discarded time-of-day entirely.
- **"Import History" moved to Supabase after all, but sourced from `audit_log`, not `rclc_loot` directly, and without a "Clear All" button.** Originally deferred (see below) because `rclc_loot` mixes paste-imports with the separate legacy-tracker rows the #320 historical import already merged in, with no column distinguishing which is which -- querying it directly would misrepresent old history as recent imports, and a "Clear All" could delete real history instead of just recent pastes. Kat wanted the visibility restored once the GAS-sourced version turned up permanently empty in practice (nothing writes to the old "Pasted Loot" sheet anymore). The fix: every successful import already logs one `'Loot Imported (RCLC)'` audit_log entry per row, and -- critically -- only genuine paste-imports ever produce that action, since it's called from nowhere else. Querying `audit_log` for that action (already RLS-scoped to the team via "Officers read audit_log") gives an exactly-accurate recent-imports list with zero schema change, reusing `resolveAuditTargetNames()`/`auditFormatTs()` from the Audit Log tab (#378). "Clear All" is dropped, not rebuilt: there's still no safe way to select only paste-imported rows out of `rclc_loot` for deletion. A properly-scoped season-reset-clearing feature is a future issue if it's ever needed, not something to improvise here.

[Full discussion -> #219](https://github.com/katogaming88/WGA-Raid-Hub/issues/219)

---

## 2026-07-09 -- Attendance writes (#218): writes-only, reads deliberately staying on Apps Script for now

Unlike roster (#216) and BiS (#217), attendance's Supabase table doesn't yet have a live pipeline feeding it real data. Checked the live DB before starting:

```
 team_id | count |    max     |    min
---------+-------+------------+------------
       1 |   829 | 2026-06-25 | 2026-03-17
```

Hellfire and Immolation have zero rows. Phoenix's 829 rows are a one-time historical import, frozen at 2026-06-25 -- the pipeline that actually produces new attendance data (`refreshAttendanceWCL` in `gs/Attendance.gs`, run weekly) still writes only to the Google Sheet, and that migration is a separate issue (#223, Phase 7), not done yet.

- **Writes move to Supabase; reads stay on the Apps Script Sheet.** Migrating grid reads now (mirroring #217's BiS precedent) would show an empty grid for any team without the historical import and a stale one for Phoenix, since nothing populates new raid nights in Supabase until #223 ships. `setPlayerStatus`/`toggleReportExcluded` (`js/tabs/tab-attendance.js`) now write to `attendance` via upsert/update, but `getAttendanceGrid` keeps reading the Sheet.
- **A second, separate write path existed and needed the same fix**: `saveAttendanceFromCard()` (`js/common.js`), fired from the player-profile "Attendance" history card rather than the Attendance tab's grid, called the same GAS `setAttendanceStatus` action through its own independent code path -- caught only during manual testing, not by grepping the issue's own scope notes (which only mentioned `tab-attendance.js`). Ported to the identical Supabase upsert + audit log shape as `setPlayerStatus`. Worth remembering for #219/#220: search the whole `js/` tree for a GAS action name before assuming a single call site, since this codebase has more than one UI surface writing to the same table more than once.
- **Accepted interim quirk: an officer's edit is session-only until reads migrate.** Since the grid still reads the untouched Sheet, a page reload shows the Sheet's stale value again -- the edit only persists in Supabase and in the existing local `_attendanceGrid` patch for the rest of that browser session. Confirmed acceptable with Kat: officer attendance workflows aren't moving onto this path in practice until the whole pipeline (including #223) is on Supabase; this PR exists to have the write half ready and waiting, not to be used for real edits yet.
- **`attendance.player_id`'s FK reconciled to `ON DELETE SET NULL`** (migration `20260709170000_attendance_player_id_set_null.sql`), matching `rclc_loot` and the decision #250 already called for but never actually migrated (the baseline dump still showed `ON DELETE CASCADE`). Column made nullable to support it; `check_team_id_matches_player()` already guards on `new.player_id is not null`, so this doesn't need a trigger change. Safety net only -- soft-delete via `archived_at` (#216/#258) is the only path roster removal takes today.
- **Audit action names and shapes carried over unchanged from GAS**: `'Attendance Status Set'` targets the player (`target_type: 'players'`, matching #216/#217's TARGET-durability reasoning), detail `"<old> -> <new>"` (matches the historical backfill's format for this exact action). `'Report Excluded'`/`'Report Exclusion Removed'` have no single player to target (they apply to a whole raid night), so `target_type`/`target_id` are `null` and the raid date goes in the detail string instead.

[Full discussion -> #218](https://github.com/katogaming88/WGA-Raid-Hub/issues/218)

---

## 2026-07-09 -- BiS list edits (#217): editor reworked to instant per-row writes; audit entries target the player, not the bis_items row

The old officer BiS editor (`js/tabs/tab-bis.js`) staged add/remove in a local array and pushed the whole list on one "Save" click, because the GAS `setBisItems` handler it called only ever supported rewriting a player's entire BiS column at once. `bis_items` supports true per-row insert/update/delete, and the issue itself flagged the editor's shape as an open design call rather than something to port as-is.

- **Reworked to instant writes, no staged state.** Picking an item, clicking `x`, and toggling the new "Obtained" checkbox each fire their own Supabase write immediately (one `audit_log` row apiece) instead of accumulating in `_bisListEditor.items` for a batched Save. Removes the "did I remember to hit Save" ambiguity the granular backend was meant to fix, and matches the instant-toggle pattern #216 already established for the Roster tab.
- **Audit entries use `target_type: 'players'` / `target_id: <player.id>`, not `'bis_items'` / `<bis_items.id>`.** `resolve_actor_name()`/`resolveAuditTargetNames()` (`tab-audit.js`) only ever resolve a TARGET by looking its primary key up in the live table. A `bis_items` id goes stale the instant "remove" runs (the row is gone), which would permanently blank TARGET for every remove entry and any add/obtain entry for an item later removed. `players.id` never disappears for an active roster member, so pointing at the player keeps TARGET showing the character name for all three actions, indefinitely. The action name and detail string (e.g. `"Chest Firelord's Vestments"`) already carry the item-level specifics; TARGET only needed to answer "which character."
- **BiS reads also moved to Supabase in the same PR**, ahead of what #217 literally scoped (writes only). Roster reads had their own migration issue before #216 shipped roster writes; BiS had no equivalent, so shipping writes-only would have made `DATA.bisList` (sourced from the Apps Script heavy chunk) go stale the moment any write landed -- a reload would show wrong BiS counts/contents everywhere the list is used (roster tab, contested items, profile checklist). `fetchSupabaseBisItems()`/`mapSupabaseBisItems()` (`js/common.js`) replace `heavy.bisList` when the Supabase read succeeds, keyed by the same raw-firstName convention `mapSupabaseRoster()` uses (`tab-conflicts.js`/`tab-priority.js` index `DATA.bisList[firstName]` directly, bypassing the normalised-lookup `getBisItems()` does).
- **Item ids resolved by exact `items.name` match at write time** (`resolveItemId()`), same approach #216 used for `classes_specs` -- no client-side id cache exists yet for either lookup table.

[Full discussion -> #217](https://github.com/katogaming88/WGA-Raid-Hub/issues/217)

---

## 2026-07-09 -- Roster edits (#216): Role dropdown dropped, Class+Spec write together

The old Player Settings panel (`js/common.js`) had three independent controls -- Role, Class, Spec -- each firing its own write, matching the old sheet's three separate columns. The migrated `players` table only has `class_spec_id` (a single FK into `classes_specs`, which pairs each class+spec with exactly one `role`); there's no column an independent role write or a class-only write could land on.

- **Role select removed entirely, replaced with a static read-only display of the derived value.** An independent role override doesn't fit the schema -- role always follows from whichever class_spec_id is set, so a selectable Role dropdown could only ever silently disagree with Class/Spec or do nothing.
- **Class and Spec stay as two dropdowns, but only Spec's onchange fires a write.** Picking a new Class only repopulates the Spec dropdown client-side (`officerUpdateClass`); the write (`officerSaveClassSpec` -> `updateClassSpecSupabase` in `js/tabs/tab-roster.js`) fires once a Spec is chosen, reading Class's current DOM value at that point and resolving both to one `classes_specs` row before updating `class_spec_id`. This mirrors the only state that's ever actually valid to write: a complete (class, spec) pair.
- **Audit label reuses `'Spec Changed'`** (not a new `'Class/Spec Changed'` label) since the historical backfill (`20260709140000_backfill_audit_log_detail.sql`) already maps `Spec Changed`/`Class Changed`/`Role Changed` to the same `'Changed to ' || to` summary shape -- one combined write reusing an existing label keeps the Audit Log tab's convention intact without adding a fourth near-duplicate action name.
- **Roster reads now include `players.id`** (`js/common.js` `fetchSupabaseRoster`/`mapSupabaseRoster`) so writes can target a row by primary key instead of `name_realm`, matching the `.eq('id', playerId)` pattern #216 called for.

[Full discussion -> #216](https://github.com/katogaming88/WGA-Raid-Hub/issues/216)

---

## 2026-07-09 -- anon/authenticated need USAGE on sequences too, not just table DML

#312 granted base table DML (`select/insert/update/delete` on all `public` tables) to `anon`/`authenticated` so RLS policies would actually get consulted on a write. Found while testing #216's Add Player flow: inserting into `players` still failed with `permission denied for sequence players_id_seq`, even though the row-level `"Officers write players"` policy permits the insert.

- **A serial/identity column's `nextval()` checks `USAGE` on its backing sequence before RLS is ever reached.** #312 only covered tables; nothing had exercised an `INSERT ... DEFAULT` through PostgREST until now, so the gap sat unnoticed. Same class of issue #332 flagged for `service_role` -- this is the `anon`/`authenticated` half of it.
- **Fix mirrors #312's shape exactly:** one additive migration (`20260709150000_sequence_grants.sql`, #383), `grant usage, select on all sequences in schema public to anon, authenticated` plus the matching `alter default privileges` so future sequences pick it up automatically. Doesn't loosen anything -- RLS still gates every row.
- **No dbdoc/RLS.md update needed** -- grants don't appear in either (confirmed against #312's precedent), so this is a schema-docs-CI no-op.

[Full discussion -> #383](https://github.com/katogaming88/WGA-Raid-Hub/issues/383)

---

## 2026-07-09 -- Historical audit_log.detail backfilled in place, legacy changed_by dropped rather than preserved

The Stage C import (#320) wrote the raw `{target, from, to, changed_by}` shape into `audit_log.detail` for every historical row; `write_audit_log()` (#214) and the Audit Log tab rewire (#378) both expect a single human-readable summary string instead. Migration `20260709140000_backfill_audit_log_detail.sql` (#377, split from #215) converts existing rows in place via `UPDATE ... WHERE jsonb_typeof(detail) = 'object'`.

- **One-time SQL backfill over fixing the importer and re-importing.** `scripts/import/tables/audit.js` doesn't need to change -- its own idempotency guard (`NOT EXISTS` on `(team_id, created_at, action)`) has nothing to do with this conversion, and a wipe-and-reimport would touch production data via delete+reinsert for no benefit over an in-place `UPDATE`.
- **Rerun-safe by construction, not by a migration-tracking table.** The `jsonb_typeof(detail) = 'object'` scope means a row already converted to a plain string is left alone on a second run, and any future write through `write_audit_log()` that happens to pass a jsonb object as `p_detail` would also need this same guard kept in mind if this migration ever needs to be edited.
- **Legacy `detail.changed_by` (a free-text Discord username, not an `auth.users` link) is dropped, not preserved.** Every historical row already has `actor_id = null` and always will (the sheet's Changed By was never an account link) -- these rows were never going to resolve a CHANGED BY through `resolve_actor_name()` (#376) regardless of what happens to `detail`, so keeping `changed_by` around in some structured form would only complicate the tab (#378) for a display gap that already existed. Confirmed with Kat rather than assumed.
- **Two corrections to the conversion map** as originally proposed in #215's comments, found by reconciling against the real distinct-action list in production (not just the `gs/wgaWebApp.gs` call sites): `Trial Status Changed`/`Bench Status Changed` store `to`/`from` as the literal strings `"TRUE"`/`"FALSE"`, not booleans; `Officer Granted`/`Officer Revoked`'s `to` is a raw Discord snowflake id, not human-readable, so both were moved from "use TO directly" into the empty-detail bucket -- TARGET (the username) already carries the meaningful part.

[Full discussion -> #377](https://github.com/katogaming88/WGA-Raid-Hub/issues/377)

---

## 2026-07-09 -- Actor-name resolution reads auth.users PII, so it's gated like a read policy, not just an execute grant

`resolve_actor_name(p_actor_id uuid, p_team_id integer)` (migration `20260709130000_resolve_actor_name.sql`, #376, split from #215) resolves `audit_log.actor_id` to a display name for the Audit Log tab's CHANGED BY column.

- **Internal authorization check, not just a GRANT restriction.** Every other SECURITY DEFINER function so far (`write_audit_log`, `claim_character`) only ever exposes or attributes the _caller's own_ data. This one is different: its Discord-display-name fallback path reads `auth.users.raw_user_meta_data` for an arbitrary other person (the case where a site admin acted on a team they don't belong to, so no `team_members` row exists to resolve a name from). Restricting `EXECUTE` to `authenticated` alone would let any raider harvest other people's Discord display names by probing actor uuids across teams they have nothing to do with. The function therefore re-checks the same `my_team_role(p_team_id) in ('officer','team_leader') or is_site_admin()` gate `"Officers read audit_log"` already enforces at the table level -- callers who couldn't read a team's audit log can't resolve names on it either.
- **Resolution order mirrors `resolveDiscordSession()`'s existing client-side priority** (`js/discord.js`): linked player's `nickname`, then the character-name part of `name_realm` (preferring the linked `players` row over `team_members.name_realm`'s legacy bridge column, same precedence `resolveDiscordSession()` uses), then the Discord display name, then `null`.

[Full discussion -> #376](https://github.com/katogaming88/WGA-Raid-Hub/issues/376)

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

Shipped: `20260709170000_attendance_player_id_set_null.sql`, the attendance FK, the one bullet of the four that shipped (measured against production 2026-09-14: no `seasons` table, no `season_snapshots`, `team_settings` readable by `public`). The seasons table shipped as `20260914224520_seasons_table.sql` (#932, 2026-09-14), keyed by `code` rather than `slug`, with tiers refused from overlapping rather than only one left open-ended (its entry above says why). Never the `team_settings`/`season_snapshots` read lock: `20260711220932_drop_season_snapshots.sql` (#455) dropped that table, and `team_settings` is public-read on purpose, since the public pages read it. Never the auth-link trigger; `admin_grant_team_role()` (`20260904052807_team_role_grant.sql`, #910) resolves the account at grant time instead.

- **Seasons table.** Adding a `seasons` lookup table (`slug` PK, `name`, `starts_at`, `ends_at`) instead of a format CHECK on `season text` columns. A CHECK can't catch a well-formed typo (`MN11` vs `MN1`); only an FK against a canonical table can. `ends_at IS NULL` also gives "current season" for free, which the priority generator and #143 (archived seasons) both need.
- **team_settings / season_snapshots SELECT policy.** Locked down to team members only (`my_team_role(team_id) is not null`). Both tables carry data with no reason to be publicly readable, unlike roster/loot which the public site intentionally exposes.
- **attendance FK on-delete.** Changed `attendance.player_id` to `ON DELETE SET NULL` (was `CASCADE`), matching `rclc_loot`. Soft-delete (`players.archived_at`, decided in #258) is the primary path; this FK change is the safety net if a hard-delete ever happens anyway.
- **Auth-link backfill.** Added an `AFTER INSERT` trigger on `team_members` and `site_admins` that backfills `auth_user_id` immediately if the person already has an `auth.users` row (covers the case where someone logs in via Discord before an officer seeds their row).
  - **Correction, 2026-09-04 (#910): that trigger was never written.** `pg_trigger` on all five grant and roster tables carries only `updated_at` and one self-update guard, and no migration contains it. The trigger that does exist, `on_auth_user_created`, is `AFTER INSERT ON auth.users`, so it fires at account creation and covers the opposite case: a row seeded _before_ the person signs in. The case this bullet describes, a row seeded _after_, was never handled, which is why production carried an unlinked grant row that read as correct and granted nothing, and why `docs/supabase-setup-guide.md` claimed the column "fills itself on first sign-in". `admin_grant_team_role()` replaces the trigger by resolving the id in the grant statement itself.
  - **Two of this entry's four bullets have now been found unshipped.** The attendance FK was caught the same way in July and is recorded at the #218 entry above ("the decision #250 already called for but never actually migrated"). The seasons table and the `team_settings`/`season_snapshots` read rule have not been checked against the live schema. A decision log records intent: an entry describing a schema object is a claim to verify against `pg_trigger`, `pg_proc` or `pg_constraint` before anything leans on the behaviour it promises.

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

Shipped: `20260704204411_initial_schema.sql` carries the tables and columns below. The `bis_items` half of the last bullet was reversed by `20260725135340_bis_items_item_preferences_season.sql` (PR #579); see its correction.

- **scoring table:** add `season text NOT NULL`, unique key becomes `(player_id, season)`. Additive per season instead of overwritten, for trend analysis and priority generation.
- **player_wcl_season_perf (new table):** separate from `scoring` -- different source (WCL character API vs. team reports), different update cadence (once per season vs. per raid import). Holds `best_perf_avg` / `median_perf_avg` fetched at season start, used as the heroic priority baseline until current-season `scoring` data accumulates.
- **Identity/lifecycle fix:** `players.team_member_id` (FK -> `team_members.id`, nullable) links a character row to the person/Discord account. `players.archived_at` (soft-delete) preserves character history across a main-swap instead of losing it to a hard-delete. `season_signups.approved_player_id` (FK -> `players.id`, `ON DELETE SET NULL`) links a signup to the character it produced.
- **Season-scoping of wipe-between-seasons tables:** `scoring` gets a `season` column (preserve history). `mplus_exclusion_requests` and `bis_items` do NOT -- both wipe between seasons on purpose (gear/tier resets the exclusion criteria and BiS lists are rebuilt fresh each tier), and that intent is written down here so it isn't mistaken for a bug later.
  - **Correction, 2026-09-14 (#943): `bis_items.season` exists.** `20260725135340_bis_items_item_preferences_season.sql` (PR #579) added it so Other Sources placeholder rows could expire with their season, and production holds 4 rows, all four carrying one season value. The `mplus_exclusion_requests` half stands. #935 retires `bis_items` altogether.
  - **Retired, 2026-09-20 (#935): the table is gone**, `20260920234054_retire_bis_items.sql`; see that entry.

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

---

## #580 -- bis_items/item_preferences: season column for Other Sources placeholder scoping

- Other Sources rows (`M+`/`Crafted`/`Catalyst`, used as BiS/Wishlist stand-ins for gear not from a raid drop) aren't tied to a raid zone, so `isItemInSeasonScope()` always treated them as in scope regardless of the viewed season -- an officer's "M+ - Head" pick from Season 1 kept showing up forever, even in a Season 2 view, unlike real items (scoped via `items.wcl_zone_id`).
- **Decision:** added a nullable `season` text column to both `bis_items` and `item_preferences`. New rows (any item, not just placeholders) are stamped with `resolveSeasonView()`'s current value -- the same `raid_zones.season`-format string ("Midnight Season 1"), not the short `priority_order.season`-style code ("MID1"). `isItemInSeasonScope(name, rowSeason)` gained an optional second parameter used only for placeholders; real items still resolve purely through `items.wcl_zone_id`, ignoring it.
- Existing rows were backfilled to each team's `team_settings.config->>'seasonName'` (the best available guess for "when was this tagged"), since neither table nor any other table records a per-team "current season" more precisely than that free-text field.
- Rows with no season stamped (backfill gap, or any future manual insert that skips the column) fail open -- shown regardless of season -- matching the existing fail-open convention for real items with no `wcl_zone_id`.
- **Follow-up not included:** `getIncompleteWishlists()`'s completeness check (`js/tabs/tab-priority.js`) still counts a raider's own stale-season Other Sources tag as "covering" a slot -- only the _display_ of these rows (BiS Lists editor, Wishlist's own Other Sources card) was season-scoped this pass.

[Full discussion -> #580](https://github.com/katogaming88/WGA-Raid-Hub/issues/580)

---

## #633 -- attendance.status: Late (with notice) / Late (no notice), 90%/50% weight

- Officers had no way to record a player showing up late without either marking them fully Present (overcounting) or as a harsher status like Excused/No Show that doesn't reflect "showed up, just not on time." Two new literal values were added to `attendance.status`'s CHECK constraint: `Late (with notice)` (90% weight) and `Late (no notice)` (50% weight) -- between `Present`/`Bench`/leave statuses (100%) and `Excused` (80%) on one side, and `No Show` (0%) on the other.
- `attendance.status` is a plain `text` column gated by a CHECK constraint, not a Postgres enum, so this is additive (`DROP CONSTRAINT` + re-`ADD` with the two new literals) -- no backfill needed, no existing rows affected.
- The weight/status list is duplicated client-side in ~6 places with no single source of truth (`ATTENDANCE_WEIGHTS_JS`, a separate and already-inconsistent `attendTrendValue`/`attendTrendColor` pair for the trend sparkline, `ATTENDANCE_STATUSES` in tab-attendance.js, two independently-declared `CARD_STATUSES` arrays in common.js for the profile card) -- all updated together this pass rather than consolidated, to keep the change additive and low-risk.
- Both new statuses count as "attended" for the trend chart's physical-presence tooltip (they did show up) but as "penalizing" in `mapSupabaseAttendanceDetails`'s below-threshold officer view (neither is full credit), same treatment as `Excused` already gets.
- **Follow-up not included** (tracked as a separate PR): tying the WCL attendance sync (`supabase/functions/wcl-sync`) into detecting probable lateness. Today the sync only determines report-wide presence/absence, not per-fight timing -- no raid-start-time-of-day is stored anywhere, and there's no "flag this row for officer review" concept in the schema. The agreed design for that follow-up: detect a player missing the raid's first logged pull but present in later ones, and flag the row via a new `source = 'WCL (Late?)'` value with `status` left empty (not set to `Present`), so it surfaces in the grid for an officer to manually classify -- the sync itself never guesses which of the two Late statuses applies.

[Full discussion -> #633](https://github.com/katogaming88/WGA-Raid-Hub/issues/633)

---

## #636 -- healer-only and tank-only trinkets filtered from wrong-role wishlist/BiS views

- Some trinkets' equip/on-use effect is entirely about healing/protecting allies (no damage, no self-buff a DPS spec could use) or entirely about reducing/absorbing damage the wearer takes (no throughput value outside a tank spec) -- but nothing in the catalog's stat data (`armor_type`/`main_stats`) rules either out, so the wrong-role specs saw them as options in the Wishlist and officer BiS grid. One of the four healer-only items (`Preternatural Antivenom`) isn't even Int-restricted -- its `main_stats` is `[]` (confirmed stat-less), so before this it showed to literally every spec in the game.
- **Decision:** two client-side denylists, not a schema column. `HEALER_ONLY_TRINKETS`/`TANK_ONLY_TRINKETS` (`js/common.js`) are Kat-curated `{itemName: true}` maps, same manual-per-tier-edit workflow already used for `CURRENT_SEASON`/`TOKEN_SLOT_KEYWORDS`. Rejected a new `items` column (manual curation via SQL Editor, or fragile tooltip-text parsing) since the affected set is expected to stay small. Every current-tier Intellect trinket (14) and every current-tier Strength/Agility/stat-less trinket (17) was checked live against Blizzard's/Wowhead's actual proc text before adding an entry -- not guessed from item names.
- Not a mechanical "must trigger off a specific word" rule -- `Soulcoiler Ritual Vessel` (healer) is a plain on-use ability, not gated behind a healing-spell cast, and `First Mate's Shellward` (tank) is a plain on-use shield, not a proc -- both still belong on their list since their only effect has zero value outside the intended role. `Idol of the Howling Nexus` (tank) was a genuine judgment call: its proc triggers off dodge/parry/block (tank avoidance stats), but has a guaranteed 15-second fallback trigger even at 0% dodge/parry/block, so it's not strictly _unusable_ by a DPS spec -- included anyway since Kat confirmed it as one of the two Season 2 tank trinkets. Judgment call each time, Kat-confirmed per item, not automated.
- Checked against the viewing player's `SPEC_ROLE` value (`'Heal'`/`'Tank'`), not their class -- so e.g. a Discipline Priest still sees a healer-only trinket while a Shadow Priest doesn't, even though both are the same class.

[Full discussion -> #636](https://github.com/katogaming88/WGA-Raid-Hub/issues/636)

---

## #609 -- items.weapon_subtype: filter Weapon/Off Hand rows by class-allowed weapon type

- `items.slot` only ever distinguished One-Hand/Two-Hand/Ranged/Off Hand -- no weapon subtype (Sword/Axe/Mace/Dagger/Staff/Polearm/Warglaive/Bow/Gun/Shield) was stored anywhere, so e.g. a Mage's Weapon wishlist row showed every class's Maces and Polearms mixed in with actual Mage-usable weapons, since neither `armor_type` (weapons carry none) nor `main_stats` (shared across many classes) rules out a wrong weapon type.
- **New nullable `items.weapon_subtype` text column**, populated by `scripts/fetch-item-stats.js` in the same pass as `main_stats`/`secondary_stats` -- zero extra network calls, since the subtype name (e.g. `"Sword"`, `"Shield"`) is already present in both the Blizzard API response (`preview_item.item_subclass.name`) and the Wowhead tooltip fallback (the `<!--scstartCLASSID:SUBCLASSID--><span>NAME</span>` marker), gated to item_class id 2 (Weapon) or id 4/subclass 6 (Shield) so an armor piece's item_subclass name (e.g. "Rings") never gets miscategorized as a weapon type.
- **Class -> allowed weapon-type table** (`CLASS_WEAPON_TYPES`, `js/common.js`) is Kat-curated static game-design data, keyed by handedness (One-Hand/Two-Hand/Ranged) since the subtype name alone doesn't distinguish them -- e.g. Mage gets One-Hand Sword but not Two-Hand Sword, while still getting Two-Hand Staff. A web reference was tried first and rejected as unreliable (came back self-contradictory on armor types, and conflated classic-era mechanics like the pre-Legion separate Ranged slot with current retail). Warrior/Rogue deliberately omitted from Ranged despite being technically able to equip it -- neither receives a ranged weapon as loot in current itemization.
- **Shield eligibility** (`CLASS_SHIELD_USERS`) is a separate flag (Warrior/Paladin/Shaman only) checked against `weapon_subtype === 'Shield'` on the Off Hand row -- non-shield Off Hand items (tomes/orbs) carry no `weapon_subtype` at all and stay filtered by main-stat only, same as before.
- Same null-safe convention as every other catalog filter here: a null/unbackfilled `weapon_subtype` shows the item to everyone rather than hiding it, so existing (pre-backfill) items aren't affected until `fetch-item-stats.js` is re-run.

[Full discussion -> #609](https://github.com/katogaming88/WGA-Raid-Hub/issues/609)

---

## #722 -- item_preferences.synced_bis: distinguish explicit vs. mirrored BiS tags on ring/trinket sibling slots

- A real ring/trinket is always unique-equip, so tagging it BiS on one numbered slot (Trinket 1, say) mirrors that same status onto the sibling row (Trinket 2) -- same physical item, can land in either socket. That mirror was previously indistinguishable from an explicit tag: both rows just read `status='bis'`, so the Wishlist card for _either_ slot showed "Already your Trinket 2 BiS pick" even on the slot the raider actually clicked.
- Surfaced by a raw SQL backfill that promoted 74 stale cross-rated rows to `bis` (correct data, done outside the app's normal write path), which exposed this display gap in the BiS List summary, the officer's read-only Wishlist view, and the raider's own interactive Wishlist cards.
- **New `item_preferences.synced_bis` boolean column** (default `false`). `false` = the row the raider explicitly clicked; `true` = the row the app wrote to keep the sibling slot in sync. `wishlistLockedBySibling()` (`js/wishlist.js`) now locks/shows the note only on the `synced_bis: true` side; the explicit side stays freely editable even though it too reads BiS.
- Considered inferring direction from `created_at` ordering instead of a schema column -- rejected as fragile: doesn't cleanly handle old/ambiguous data, and relies on the sync write always landing microseconds after the explicit one.
- Existing pairs backfilled by `created_at` ordering within each same-item Finger/Trinket pair (earlier row = explicit, later = synced) in the same migration, since every current dual-BiS pair in the live data matched exactly that shape.

[Full discussion -> #722](https://github.com/katogaming88/WGA-Raid-Hub/issues/722)

---

## #903 -- officer_set_rsvp(): the officer-correction path raid_rsvps was left without

The 2026-09-03 "raid_rsvps has no public or officer write policy at all" decision (above) deliberately left every write to `set_own_rsvp()`, but named the exact shape a future correction path should take if one ever became needed: "its own explicitly-named function/action later, not a blanket write grant." #903's per-day calendar view asked for exactly that -- officers correcting another raider's RSVP inline.

`officer_set_rsvp(p_team_id, p_player_id, p_raid_date, p_status, p_note)` is that function, SECURITY DEFINER, gated the same way as `set_team_officer_bios()` (officer/team_leader via `my_team_role()`, or `is_guild_officer()`, or `is_site_admin()`). `raid_rsvps`'s RLS is untouched -- still SELECT-only, no INSERT/UPDATE/DELETE policy for anyone; this RPC remains the only officer write path, same shape as `set_own_rsvp()` for raiders.

Two deliberate differences from `set_own_rsvp()`:

- Takes `p_player_id` as a parameter rather than resolving from `auth.uid()` -- an officer is acting on someone else's row, not asserting their own status, so there's no "own row" TOCTOU concern to design around here.
- No bench-on-a-normal-night gate on the target player. `set_own_rsvp()` blocks a bench raider from setting any status on a normal night because there's nothing for them to override there; an officer correction has no such restriction, since fixing a bench player's row (including on an optional night) is exactly the use case.
- A note is always required, even though the officer -- not the raider -- initiated the change, so the raider can see why their status was changed on their behalf.

[Full discussion -> #903](https://github.com/katogaming88/WGA-Raid-Hub/issues/903), part of #640.

---

## #924 -- players.is_rotator: a third roster status, officer-assigned per raid week rather than self-RSVP

Phoenix needed a roster status for a pool of players who rotate through a shared raid slot rather than each having a guaranteed spot: not automatically Present/Attending like a full roster member (same as Bench), but unlike Bench, individual rotators don't self-RSVP their own "in" status -- officers pick who's in for the week.

**New `players.is_rotator` boolean**, parallel to `is_bench`, set from the same roster-editing UI (`js/tabs/tab-roster.js`).

**Granularity: per raid week, not per raid night.** An officer thinks in terms of "who's rotating in this week," not clicking through each individual raid date -- picking a fixed number of slots or a day-level grain would have made the common case (assign someone for the whole week) require N separate actions. `raid_rsvps` stays per-date/per-player though (no new week-grain table): `officer_set_rotator_week(p_team_id, p_player_id, p_week_start, p_in)` recomputes the raid nights inside the Sunday-Saturday week containing `p_week_start` the same way `js/calendar.js`'s `computeRaidNights()` does client-side (an active `raid_schedule` weekday rule, minus a `cancelled` exception, plus an `added` one), and fans the single week-level call out into one `Rotator-In` `raid_rsvps` row per night (or deletes them all, for `p_in = false`). A `Rotator-In` row is picked up by the same per-date override lookup every other RSVP status already goes through, so the calendar UI needed no new read path -- only a new write one.

**Rotators can still self-RSVP.** `set_own_rsvp()` already only gates on `is_bench`, not `is_trial`/`is_rotator`, so a rotator can self-flag Late/Leaving Early/Tentative/Absent without any change to that function -- letting a rotator say "I can't make it" even on a night they weren't assigned. There is no rotator-facing way to self-mark "in"; that stays exclusively `officer_set_rotator_week()`.

**Loot priority:** `generate_priority_order()`'s `status_tier` sort (2026-07-31 decision, above) gains a fourth tier -- Rotator sorts below a full-status raider but above Bench, inserted between the existing Trial (1) and Bench (now 3) tiers, at 2. No score discount, same as the existing tiers -- purely a sort-order change.

[Full discussion -> #924](https://github.com/katogaming88/WGA-Raid-Hub/issues/924), part of #640.

## #956 -- boe_items.found_posted_at: a claim column rather than a dedup table

`boe-webhook` posted whatever its caller sent it, and that caller is the public report card, so the guild channel printed whatever reached the endpoint. The function takes a row id now and posts what the row holds, which needs one guarantee from the database: a find is announced once.

**A nullable column on the row, not a table of sent messages.** `update ... where id = $1 and found_posted_at is null returning id` is the whole mechanism: the winner of a race gets the row back, the loser gets nothing, and a refused post sets it back to null so a Discord outage does not cost a find its message. A separate table would carry a foreign key, a policy and a cleanup story for one boolean fact per row. `raid_signup_sheets.message_id` is the same shape one table over.

**No new policy and no new guard.** `check_boe_status_transition()` compares old and new with the metadata columns subtracted, so any column outside that list is already refused to `authenticated`, and the UPDATE policy already admits neither anon nor a plain raider. The service role bypasses both, which is what the Edge Function connects as. That is the argument #889 made for `finder_discord_id`, reused rather than re-litigated.

**No audit_log row.** `write_audit_log` needs `auth.uid()` and the service role has none. The column is the record.

**The first `*_at` here with no status coupling.** The other four are lifecycle facts carrying an `iff` CHECK against `status`; this one says a message was sent, which is true of a row in any state. The migration backfills existing rows from `created_at`, because rows left null would each be claimable once by anyone who guesses an id at an endpoint that takes no credentials.

[Full discussion -> #956](https://github.com/katogaming88/WGA-Raid-Hub/issues/956).

## #969 -- app_version(): the migration ledger head as a public fact

Shipped: 20260909170340_app_version_ledger_head.sql

The schema had no version anyone could ask for. The ledger holds one, `supabase_migrations.schema_migrations`, but it sits outside `public`, is owned by `postgres`, and grants nothing to any API role, so no client could read it and no page could tell whether the database behind it was the one its code expected.

**A function rather than a grant.** Opening the ledger to `anon` would answer the same question and hand over the applied statements alongside it, since that table stores each migration's SQL in a `statements` column. The definer function returns two scalars derived from it. The distinction is asserted rather than asserted-to: the test calls the function and selects from the table in the same transaction as the same role, and expects the second to be refused.

**`{head, count}` and nothing more.** The table has three columns and no timestamp, so an applied-at is not available to return, and the count is worth the extra field because it separates "behind by one" from "restored from a backup" at a glance. Anything richer would be describing migrations to a raider's browser.

**No `service_role` grant.** Nothing server-side asks this. The Edge Functions connect with a key that bypasses RLS and could read the ledger directly if one ever needed to.

[Full discussion -> #969](https://github.com/katogaming88/WGA-Raid-Hub/issues/969).

## #1050 -- migrations reach production from the deploy pipeline, ahead of the site

Shipped: no migration. Workflow and CI only; the read half is `app_version()` from #969.

A frontend release deployed the moment it merged, because GitHub Pages built from `main` on its own in about forty seconds, while `supabase db push` stayed a separate step someone ran in a terminal afterwards. Between those two the deployed site called RPCs the database did not have, and the failure surfaced as scattered errors at individual calls rather than as one statement about the system.

**Prevention rather than detection.** #970 proposed reading the ledger head at boot and showing a banner while it trailed `REQUIRED_SCHEMA`. That describes the window accurately and leaves it open. One workflow now applies the migrations and then publishes the site, with the publish depending on the apply, so after every successful deploy the two values agree by construction and there is nothing left for a banner to report. #970 closed as superseded.

**The credential already existed.** `SUPABASE_DB_URL` carries the ledger read in three workflows, and that read touches a table only `postgres` can see, so the deploy needed no new secret and no new trust.

**Applying is no longer a thing anyone remembers to do, so the ledger discipline stops being advisory.** SQL applied by hand in the dashboard leaves `supabase_migrations.schema_migrations` behind; that already failed a check, and now it blocks every deploy until `supabase migration repair --status applied` runs. The consequence lands on whoever can fix it rather than on raiders, which is the argument against the banner restated.

**The pull request check had to change meaning, because the normal state changed.** A committed and unapplied migration used to mean somebody forgot to push; it now describes every migration PR before its merge. The check takes `--pending-ok` there and passes those, while still failing the two shapes that describe a push which would refuse: a pending file sorting below the newest applied version, and a ledger row with no file behind it. The strict form runs in the deploy, straight after the push, where anything pending means the push silently did not take.

**Jekyll stays in the loop deliberately.** `build.json` carries empty front matter so that the deployed commit and build time are rendered into it, and that file is the only record of which commit is live. The workflow runs the same build container Pages ran, so switching the publishing source changed who invokes Jekyll rather than what it produces.

[Full discussion -> #1050](https://github.com/katogaming88/WGA-Raid-Hub/issues/1050).

## #1216 -- boss lineups: a standing group per boss, copied into each raid night

Shipped: 20260918005412_boss_lineups.sql

Phoenix runs 24 raiders into 20 seats per boss, and the seats rotate boss by boss and night by night instead of benching or rotating people for a whole night. Kat and the officers picked the grid layout on 2026-09-17: raiders down the side, the season's bosses across, a click puts a raider in or takes them out for that boss.

**What is stored is the plan the officers make: "this group kills boss 5".** Kat chose this on 2026-09-18, from Rex's review of the first draft on [#1231](https://github.com/katogaming88/WGA-Raid-Hub/pull/1231). Three tables: `boss_groups` holds the standing group per boss, kept once and changed only when the team changes; `raid_night_bosses` holds the bosses on one night's list; `raid_night_lineups` holds that night's plan, one row per raider in for a boss. A night is filled from the groups ahead of time and then edited for that night only. A change meant to stick is made to the group ("Save to the group" beside "Save tonight" on the page).

**Why not store only who sits out.** The first draft stored the sit-outs and worked out "in" from whoever was left on the roster that night. That is cheap when everyone fits, but on a 24-on-20 team it needs four rows per boss every night anyway, and it goes quietly wrong on every roster change: a raider who joins mid-week is in for every boss, over the cap, with no signal; a raider who is archived or swaps mains (`review_main_swap_request()` archives the old row) drops out of the plan; a raider who answers Absent vanishes and comes back if they clear it. And a night already played cannot be reconstructed, because "in" depended on the roster as it was then. With the plan written down, each of those becomes something an officer sees: a joiner is available until placed, an archived raider leaves a hole, "planned in, now Absent" is a conflict to re-plan, and a night nobody planned reads as not planned. The cost is about 160 rows a night against about 32, which is nothing to Postgres. Assignments without standing groups were weighed too; they need the officers to copy the plan by hand every week for a lineup that rarely changes.

**A night follows its groups until an officer saves it.** `fill_raid_night()` puts every boss of that night's season that has a group on the list, in pull order, with the group minus archived and bench raiders. Bench raiders are left out of every fill, even when they are in a group (Kat, 2026-09-18): everyone on the roster shows on the grid, a bench raider starts out on every boss, and an officer puts them in for a fight or the whole night. pg_cron runs it hourly for the coming week (`fill_upcoming_raid_nights()`), and only on nights with no plan, so a raid added mid-week is filled within the hour and nothing already planned is overwritten. Until an officer saves a boss for a night (`confirmed_at`), editing that boss's group also updates it on the coming nights, so a group changed on Tuesday reaches Thursday. Once saved, the night keeps what was saved. A boss the team is not pulling that night stays on the list as `skipped`, so "not tonight" is recorded and a night with every boss skipped is not refilled.

**Bosses by `raid_encounters.id`, not by name.** `wcl-progression-sync` upserts every encounter of a zone from Warcraft Logs on every run, before any report exists, and Season Settings' "Refresh from WCL" stamps each boss with its Warcraft Logs id, so a boss listed there has a row within a sync. A renamed raid or boss keeps its plan. `raid_zones.season` and `is_mini_raid` give the season and the seat cap. A hand-typed boss with no zone cannot be planned until the sync sees it.

**Two officers on one night.** Every write takes the same per-team `pg_advisory_xact_lock`, so overlapping saves queue instead of interleaving. Each save also sends the list the page last read (`expected_player_ids`), and the function refuses the save if the stored list has changed since, so an officer on a stale page reloads rather than silently undoing someone else's swaps.

**Functions, no table write grant.** `set_boss_group()`, `plan_raid_night()`, `set_raid_night_lineup()` and `set_raid_night_boss_skipped()`, each gated like `officer_set_rsvp()`, refusing raiders who are archived or on another team, and writing one audit entry carrying the full list. `boss_groups` and `raid_night_lineups` carry the `check_team_id_matches_player()` trigger like the other `(team_id, player_id)` tables.

**The team's raiders read it.** Each raider will see "your bosses tonight" on the night page, so the read covers anyone with an active character on the team, plus officers, guild officers and site admins. No public read.

**Not decided here:** whether the bot tells a raider when they are swapped out; whether bosses already killed this week grey out (that needs the progression sync to keep weekly kills, a separate change); and attendance taking the lineup as its reference, so a planned sit-out on the first boss is not flagged as late ([#1242](https://github.com/katogaming88/WGA-Raid-Hub/issues/1242)).

[Full discussion -> #1216](https://github.com/katogaming88/WGA-Raid-Hub/issues/1216).

## #1244 -- the boss lineup's per-boss cap and role targets come from data

Shipped: 20260918164633_boss_lineup_role_targets_and_caps.sql

The lineup grid (#1231/#1232) checked every boss against numbers typed into `app/src/calendar/lineup.ts`: 20 for a Mythic raid, 25 for a mini raid, from `raid_zones.is_mini_raid`, plus two tanks and four healers wanted. Kat's comment on the issue found the gap that forced this: Nymrissa Wavecaller and Kith'ix are flex bosses inside The Venomous Abyss that allow 25 on Mythic while the raid's other eight allow 20, and WCL lists all ten under one zone, so a cap that lives on the zone can never say that -- both grids read a 24-raider group on those two bosses as "4 over" when it is fine.

**The cap moves to the boss.** A nullable `cap` on `raid_encounters`, null meaning "use the raid's own cap" (today's `is_mini_raid` rule, unchanged). `set_encounter_cap()` sets or clears it.

**Role targets get their own table, not a column on anything shared.** Unlike the cap, tanks-wanted and healers-wanted are a team's own call, not reference data every team reads the same way, so they live in a new `team_lineup_settings`, one row per team, keyed by `team_id`. A team with no row uses today's 2 tanks / 4 healers -- nothing is seeded for the four teams that already exist, matching how the app already treats a missing `team_settings` key. `set_lineup_role_targets()` upserts.

**Two different gates, because the two writes are not the same shape of thing.** `raid_encounters` is shared across every team -- one row per zone and season, upserted by whichever team's `wcl-progression-sync` run reaches it first -- so there is no team to check a plain officer against; `set_encounter_cap()` is gated on `is_guild_officer()` or `is_site_admin()` alone, the same way other guild-wide reference writes are. `team_lineup_settings` is per-team, so `set_lineup_role_targets()` takes the same gate `set_boss_group()` does: the team's own officers and leader, a guild officer, or a site admin.

**The sync cannot clear a cap by accident.** `wcl-progression-sync`'s `upsertEncounters()` sends only `zone_id, wcl_encounter_id, name, sort_index` in its upsert payload; Postgres only overwrites the columns a caller actually sends, so a nightly sync run leaves a hand-set `cap` alone.

**Not in this migration:** unifying the buff list `js/common.js` (RAID_BUFFS/BOSS_DEBUFFS/RAID_UTILITY) and the app's own curated 13-buff subset read -- the third piece #1244 named. That is a bigger, cross-codebase change (one data source both the current site and the new app fetch from, and a decision about which buffs the lineup check itself cares about versus the roster page's fuller coverage widget) than the two schema pieces here, so it stays open on the issue rather than riding along.

[Full discussion -> #1244](https://github.com/katogaming88/WGA-Raid-Hub/issues/1244).

## #944 -- team_id on scoring and player_equipped_gear; the guard on every two-key table

Shipped: 20260918165131_team_id_on_scoring_and_equipped_gear.sql

Every table that files a row against a player also names the player's team, so a team's rows are read by filtering on the row and the RLS policy can scope on the row. `scoring` and `player_equipped_gear` were the last two keyed by player alone: a team-wide read of either joined through `players`, the shape the #694 row-cap sweep came from, and `scripts/ci/team-wide-read-check.js` cannot see a `players.team_id` join at all, so the equipped-gear read on the current site sat outside the check with no paging. Three two-key tables (`player_wcl_season_perf`, `raid_rsvps`, `raid_rsvp_reminders_sent`) carried both columns with no trigger. Measured on prod 2026-09-05: zero rows disagreed across every table that had both columns.

**The column, backfilled and `not null`, with the trigger on all twenty.** `team_id integer not null references teams(id) on delete cascade` on both tables, filled from `players.team_id` (itself `not null`, so the backfill leaves no gap), and `check_team_id_matches_player()` on the five tables that lacked it. The acceptance query (triggers whose function names both columns) answers 20; the eighteen two-key tables at the time of the build had fifteen guarded. No index on `team_id`: both unique keys lead with `player_id`, the tables are one row per player per season and per equipped slot, and half the two-key tables carry none.

**A write to either table names the team.** With `not null`, every writer sends `team_id`: the three score commits on the current site (attendance scores, performance scores, the season-perf seed), the `blizzard-gear-sync` Edge Function's upsert, the #320 import generator and the seed. The team is in scope at every one already, so nothing looks it up. A row filed under the wrong team is refused where it is written rather than found later.

**The team-wide reads filter on the column and page.** The current site's equipped-gear read and the new app's roster gear read filter on `team_id` and page (`fetchAllPaged`, `readAll`), which puts the first in front of the read check. Reads keyed by one player, and the database functions that join `scoring` per player (`generate_priority_order()` and its kin), are unchanged: they were never team-wide.

**Not decided here:** the write policies on both tables still resolve the team through the `players` subquery (`Officers write scoring`, `Officers write player_equipped_gear`); every other two-key table's policy reads `team_id` directly, and moving these two is a separate RLS change with its own cases. `bis_items` stays keyed by player alone until [#935](https://github.com/katogaming88/WGA-Raid-Hub/issues/935) retires it.

[Full discussion -> #944](https://github.com/katogaming88/WGA-Raid-Hub/issues/944).

## #757 -- submit_self_received() and direct_mark_received(): one live report per character, item, slot and track

Shipped: 20260918214304_self_received_duplicate_guard.sql

A raider who did not see the confirmation clicked Mark Received again and both rows landed; with auto-approval both were approved with no officer in between (8 exact duplicate approved rows across 4 players on prod, measured 2026-08-25, cleaned up by hand through #756's Delete). `submit_bis_link()` had the same hole until `20260810224022` added its pending check.

**The key is character, item, slot and track.** Character and item alone would refuse legitimate reports: a placeholder item (M+, Crafted, Catalyst) repeats across several slots for one character, and a dual-slot item sits in both sibling slots. Slot and track compare with `is not distinct from`, so a row from before #386 with no slot matches a report sent with none and not one sent with a slot. Source and note are outside the key: a resubmit that changes the note is still the same report, and the officer reads the pending row's note.

**Pending and approved block; rejected and deleted do not.** Rejection means "not this one, try again if things change", and a deleted row is gone, so `delete_self_received_request()` is also the way to a second row when an officer truly wants one. The sentence names the state of the row found: waiting for an officer, or already marked received for the character (the approved row may be the officer's own, so the raider's sentence does not say who reported it), and the difficulty of that row (at Mythic, at Heroic, on the Champion track; left out when the row carries no track). The difficulty is there because the row keeps its Mark received button until the higher track is on file, so a refusal that named none read as "you cannot mark this at all" when picking Mythic would have worked. Both forms on the current site show the sentence as it is; the new app's form already did.

**The officer path carries the same guard.** An officer misclick makes the same pair, and the corrections UI deletes the survivor when a second row is wanted. `direct_mark_received()`'s sentences point at the pending report ("approve or reject that one") rather than a second row.

**A row lock rather than a partial unique index.** The character lookup in both functions takes the `players` row `for update` (the lock `delete_self_received_request()` and `add_signup_to_roster()` already use), so two submissions for one character serialise and the second's check runs on a fresh snapshot that holds the first's committed row. A partial unique index over the live statuses would say the same thing, and `main_swap_requests` has one, but prod still carries duplicate pairs the index would refuse to build over, and deleting them belongs to the audit-logged Delete rather than a migration. The index is the follow-up shape once the table reads clean; the existing duplicates are left where they are.

[Full discussion -> #757](https://github.com/katogaming88/WGA-Raid-Hub/issues/757).

## #1264 -- team invite links: schema, reset, resolve

Shipped: 20260922152211_team_invite_links.sql

First slice of #1264 (join a team, and its guild, straight from a link): the code, its expiry, and reset. The officer panel that surfaces it, the `/join/<code>` page that lets someone act on it, and everything past the character limit and the guild-only front page stay open (#1259, #1226 are both unbuilt, so the over-limit flag and the teamless/front-page states aren't buildable yet either).

**One row per team, not a link history.** `team_invite_links` is keyed on `team_id`: generating or resetting a link is `INSERT ... ON CONFLICT (team_id) DO UPDATE`, which overwrites the code and expiry in place. The issue's decided shape ("officers can reset it, which stops the old one working") never asks for more than one live link per team, so a log table of every code ever issued would be tracking history nobody reads.

**No public read on the table itself.** Every other team-scoped lookup table in this schema (`teams`, `team_settings`, `team_seasons`) is `Public SELECT`, but a code is a bearer credential, not a lookup value -- reading the table would let anyone enumerate every team's current invite code. The officer-only `SELECT` policy (officer/team_leader via `my_officer_team_ids()`, `is_guild_officer()`, `is_site_admin()`) is for team settings to display and copy the link; the public `/join/<code>` page instead calls `team_invite_link_resolve(code)`, a `SECURITY DEFINER` function grantable to `anon` that returns the team and guild a live code belongs to and nothing else -- no code enumeration, no table scan.

**No table INSERT/UPDATE/DELETE policy.** `team_invite_link_reset()` is the only write path (same officer/team_leader/guild-officer/site-admin gate as the read policy), so a code is always the concatenation of the team's slug and `new_url_code()` (added by #1114) rather than something a client could set to an arbitrary or guessable value.

**Expiry is a plain nullable timestamp, not a duration enum.** The issue's four options (1/7/30 days, or none) are a UI concern -- the officer panel computes `now() + interval` and passes the resulting timestamp (or null) to `team_invite_link_reset()`. Storing a duration string in the database would mean re-deriving "still active" against whatever moment the link was last reset from, for no reader that needs it.

**`team_invite_link_reset()` writes an audit entry.** A reset is the moment the old code stops working and a new one starts -- the same shape as `set_team_season()` (#939) and #770's BoE lifecycle writes, both of which call `write_audit_log()` from inside the function rather than leaving it to the caller.

**Deferred to the next PR:** everything that turns a resolved code into guild + roster membership -- `/join/<code>`'s Battle.net sign-in and character pick, and the actual `team_members`/`players` writes. There is no `guild_members` table to write to separately: today, joining a team's roster (a `team_members` row) already is the guild membership, since every team belongs to exactly one guild (`teams.guild_id`, #1114) and #1045's multi-guild-per-person question is still open.

[Full discussion -> #1264](https://github.com/katogaming88/WGA-Raid-Hub/issues/1264).
