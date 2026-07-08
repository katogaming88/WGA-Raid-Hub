# Changelog

All notable changes to WGA Raid Hub will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
with each release split into `### Frontend` (drives the version number) and
`### Backend` (migrations and import tooling, no version bump) sections.

---

## [Unreleased]

### Backend
- **Raider character claim flow, backend half (#212)** -- Added `claim_character(team_id, name_realm)`, a `SECURITY DEFINER` function that links a raider's chosen character to the person layer: it sets `players.team_member_id` to the caller's `team_members` row, creating that row with `role = 'raider'` on a first claim and reusing an unlinked row imported from the Discord Claims sheet (#338) rather than duplicating it. It refuses a character that is archived, missing, or already claimed. A new self-read RLS policy lets a member read their own `team_members` row, which the login session read (`resolveDiscordSession`) needs for a raider's `nameRealm` to resolve. A one-time backfill links the pre-migrated claims to their `players` rows on the canonical `team_member_id` model. The frontend that calls this ships separately (v3.19.0). Also captures the `on_auth_user_created` trigger in a migration: it was created by hand in the dashboard and existed only on production, so local and CI stacks could not exercise the claim path against it until now.

---

## [3.18.1] - 2026-07-08

### Frontend
- **Audit log records the acting officer again (#364)** -- The Supabase login swap (#211) dropped the Discord session token from the client session, and that token was the only thing that told Apps Script who made a change. Officer writes still served by Apps Script (attendance, BiS, received items, and the rest until Phase 5) were logging a blank "changed by" as a result. The site now sends the signed-in officer's Discord username as `changedBy` instead, and Apps Script uses it when no token is present (old cached sessions that still send a token keep working). Both team deployments need a redeploy for the Apps Script half to take effect; until then attribution stays blank, the same as before this change.

---

## [3.18.0] - 2026-07-08

### Frontend
- **Discord login now goes through Supabase Auth (#211)** -- Replaced the hand-rolled popup OAuth flow (`discord-callback.html`, `window.open`, `postMessage` relay, CSRF `state` param) with Supabase's `signInWithOAuth()` full-page redirect. `js/discord.js` maps the resulting Supabase auth session to the `{ username, nameRealm, isOfficer, isAdmin }` shape `officer.js` already consumes via `onDiscordLoginComplete` / `onDiscordSessionRestored` / `onDiscordInitNoSession` / `onDiscordLogout`, so no changes were needed there. Role and admin tier come from `team_members` and `is_site_admin()` respectively. Login mechanism only -- the character-claim write (#212) and removing the now-redundant GAS OAuth redirect (#213) are separate follow-ups; `discord-callback.html` is deleted since the new flow no longer needs a relay page.

---

## [3.17.2] - 2026-07-08

### Frontend
- **Removed the Apps Script loot fallback (#210 cutover cleanup)** -- Both team GAS deployments were redeployed to drop `lootCounts` (retired in #358), confirmed live via the `heavy` chunk. The frontend no longer falls back to `heavy.lootCounts` when the Supabase loot query fails; it now resolves to an empty loot feed instead, since there is no longer an alternate source to fall back to.

---

## [3.17.1] - 2026-07-08

### Frontend
- **Fixed unreadable Discord reauth button on the officer password prompt** -- `.site-nav-discord` is styled for the transparent top-nav bar, but the reauth "Continue with Discord" button in the officer prompt pairs it with `.btn` instead of `.site-nav-item`, so it had no background set and fell back to the browser's default white button with `--text-muted` text on top -- washed out and hard to read. Added a `.btn.site-nav-discord` variant with a blurple-tinted background matching the surrounding reauth box.

---

## [3.17.0] - 2026-07-08

### Frontend
- **Public loot reads from Supabase (#209)** -- The loot feed (player cards, Recent Loot, landing totals, fairness and priority views) now builds from the `rclc_loot` table instead of the Apps Script heavy payload. Rows are remapped client-side to the exact shape the Apps Script emitted -- same first-name keys, award dates formatted in the sheet's Eastern timezone, Hero/Myth/Champion tracks shown under the Heroic/Mythic/Other labels the UI expects, and the stored season code shown under its sheet display name -- so nothing changes visually. The query fetches every season for the team and pages past PostgREST's 1000-row cap; on any failure it falls back to the Apps Script loot feed while that still exists. The Apps Script stops serving `lootCounts` (both team deployments need a redeploy after this merge). One sheet-era artifact is deliberately not reproduced: the old feed collapsed a genuine same-minute double drop into one entry, so phoenix's item total now reads 156 where the sheet showed 155.

---

## [3.16.0] - 2026-07-07

### Frontend
- **Public roster reads from Supabase (#208)** -- Both pages now load the roster from the `players` table (with class/spec/role joined from `classes_specs`) instead of the Apps Script payload. The rows are mapped to the exact shape the Apps Script emitted, so nothing changes visually. Attendance and the M+ exclusion fields still merge in from the Apps Script payload: attendance is computed live from the Attendance sheet, and the M+ request flow stays officer-gated until Phase 5. If the Supabase query fails, times out, or returns nothing, the page falls back to the Apps Script roster and keeps working. New frontend unit tests (`npm run test:frontend`) cover the mapping and the fallback, with their own CI job.

### Backend
- **Departed characters keep their loot history (#209)** -- The loot importer now creates archived stub players rows for names no longer on the Roster (the same treatment attendance and scoring always had) instead of leaving `player_id` null, so every imported loot row carries character attribution. A one-time relink script backfills the 67 phoenix rows imported before the change (24 departed characters); the upcoming Supabase loot read depends on it, since a player-keyed read would otherwise drop those items from the public loot totals and Recent Loot feed.
- **Roster re-imports reconcile instead of insert-only (#208)** -- Re-applying a team's generated import now updates changed player fields from the Roster export (spec swaps, nicknames, trial/bench flags, BiS links, join dates), revives a returning player's archived row in place (keeping their history), and archives active players who left the sheet roster. Unchanged rows are not touched, so `updated_at` still means a real edit, and a second apply reports zero affected rows. All other sections stay insert-only. This is the roster refresh path while the site reads players from Supabase but roster edits still happen on the sheet (until Phase 5): regenerate from a directory holding just a fresh Roster.csv (see the header of scripts/import/generate.js) and re-apply. The M+ exclusion fields are never overwritten on update.

---

## [3.15.2] - 2026-07-07

### Added
- **Type checking for the frontend JS (#331)** -- `js/common.js` now opts into TypeScript's checker with `// @ts-check` and JSDoc annotations, and a new "Type check" step in the lint CI runs `tsc --noEmit` (also available locally as `npm run typecheck`). There is still no build step: the `.js` files ship exactly as they are, and a new `js/globals.d.ts` declares the window globals (the supabase CDN client and the JSONP callbacks) for the checker only. The remaining `js/` files opt in as they get touched; generated Supabase types come after the Phase 2 schema settles, per the issue.

---

## [3.15.1] - 2026-07-07

### Fixed
- **`scripts/fetch-items.js` runs again (#301)** -- The script still used a CommonJS `require` after `scripts/` became an ES module package, so `node scripts/fetch-items.js` threw before doing anything. The require is now an import, and the script only starts its Wowhead fetches when executed directly, so the test suite can load it without hitting the network.

---

## [3.15.0] - 2026-07-07

### Changed
- **Loot columns store item track, named and valued as track (#343)** -- The `difficulty` columns on `rclc_loot`, `self_received_requests`, and `priority_order` are renamed to `track` and store the real upgrade-track names: Champion, Hero, Myth (previously the hybrid Champion/Heroic/Mythic). The columns always meant track: the app translated Normal drops to "champion", and self-received uses the values for vault/crafted/catalyst items that never dropped at a raid difficulty. The migration updates existing rows in place; the importers translate the sheet's difficulty words on the way in; priority_order stays Hero/Myth only, since Champion loot is handled by loot council outside the priority system. The sheet and current UI keep their vocabulary until the Phase 2/5 switches.

---

## [3.14.0] - 2026-07-07

### Added
- **Discord Claims import into team_members (#338)** -- The importer now reads a team's Discord Claims tab and backfills each claim as a `team_members` row (`role = 'raider'`), so the auth trigger can match a raider's Discord ID on their first Supabase login and existing claims carry over instead of everyone re-claiming. A claim for an already-seeded officer or team leader keeps the existing role and only fills in a missing `name_realm`. Claim IDs mangled by sheet number formatting (scientific notation loses digits) are skipped with a printed warning, since a truncated ID would silently never match at login. Verified on the local stack: 6 of hellfire's 7 claims import (one skipped for a mangled ID), seeded officer rows keep their roles and gain their character links, and a second apply changes nothing.

---

## [3.13.3] - 2026-07-07

### Fixed
- **Roster import accepts the full-sheet export layout (#320)** -- The hellfire Roster export ships the sheet's two banner rows (title and description) above the header, which the roster parser rejected because it expected the header in row 1. The parser now locates the header row by content within the first few rows, so both the cleaned phoenix layout and the full-sheet hellfire layout import. Verified against the hellfire export on the local stack: 15 players and 59 audit rows import, and a second apply inserts zero rows. The hellfire signup-flow tabs (Pending Roster, Discord Claims, Roster Responses) are out of scope for the historical import and stay in the sheet until the signup flow itself moves.

---

## [3.13.2] - 2026-07-07

### Added
- **`.env.example` template is now tracked** -- the root `.gitignore` was ignoring the example env file along with the real one, so the template never traveled with the repo. The ignore rule now covers only `.env`/`.env.local`; `.env.example` documents the expected variables (Supabase URL and keys, pooler `DATABASE_URL`) with empty values.

---

## [3.13.1] - 2026-07-07

### Changed
- **Clarified the Admin Danger Zone's "Clear M+ Exclusions" label** -- renamed to "Clear M+ Exclusion Requests" to distinguish it from the M+ Exclusions tab's own "Clear All Exclusions," which clears a different thing (the active exclusion flag on players, not the request history).

---

## [3.13.0] - 2026-07-07

### Added
- **supabase-js client on both pages (#207)** -- index.html and officer.html now load the supabase-js v2 library and initialize a shared client in `js/common.js`, and each team's config carries its Supabase team id (verified against the live `teams` table). Nothing reads from Supabase yet: the JSONP backend stays in charge of every feature, and if the CDN script fails to load the site works exactly as before. This is the foundation for the Phase 2 public read switches (#208, #209).

---

## [3.12.2] - 2026-07-07

### Fixed
- **Loot Data import accepts the export's two-digit-year dates (#320)** -- The real Loot Data export writes its date column as `3/19/26`, which the import date parser rejected (it only knew 4-digit years). The parser now accepts `M/d/yy` with or without a time, expanding to `20yy`. Verified against the phoenix export on the local stack: all 156 loot rows import (102 Heroic, 54 Mythic, season MID1, Eastern timestamps), 19 old-tier items auto-created, and a second apply inserts zero rows.
- **Schema reference doc matches the live difficulty vocabulary** -- `docs/database-schema-reference.md` still described the `rclc_loot.difficulty` CHECK as Normal/Heroic/Mythic; the live constraint is Champion/Heroic/Mythic with Normal translated to Champion on import (decided on #320).
---

## [3.12.1] - 2026-07-07

### Fixed
- **Import generators match the real CSV exports (#320)** -- The parsers were written against the raw sheet tab layouts, but the actual exports are flattened: headers sit in row 1, the Roster and Scoring tabs carry different column sets, and player names arrive as "First-Realm - Nickname". The Roster, Scoring, and Item Lookup parsers now read the exported layouts, dash-separated nicknames are stripped everywhere names are matched, and M/d/yyyy join dates are accepted. The Item Lookup's "Crafting" placeholder row is renamed to "Crafted" on import to match the app vocabulary the BiS cells already use, and the Attendance parser skips the export's excluded-reports trailer and blank-status rows with a printed warning instead of aborting. Verified end to end against the phoenix exports on the local stack: full generate, apply, and a second apply inserting zero rows.

---

## [3.12.0] - 2026-07-06

### Added
- **Signup-to-roster promotion in the database** -- The old sheet's Pending Roster tab is now a signup state instead of a table: approved signups waiting for the roster add are exactly `season_signups` rows at `status = 'approved'`, readable by officers through the new `pending_roster` view. A new `add_signup_to_roster()` function performs the add as one transaction: it creates the player (or unarchives a returning character, or links an already-active member without resetting their trial flag and join date), archives the old character on a main swap, and marks the signup `added`. A CHECK constraint guarantees a signup can only link to a player once it is `added`. Authorization rides on the existing officer policies; applicant names stay invisible to the public until the add happens.

---

## [3.11.0] - 2026-07-06

### Added
- **Self Received Requests import (#320, decided in #322)** -- Migration adds `difficulty`, `source`, and `note` columns to `self_received_requests`, and a new generator imports the tab with the mixed Source values split the same way the app reads them: a "Mythic:"/"Heroic:" prefix wins, a bare value defaults to Mythic, and the base tier stores as Champion. The legacy loot export's response and note columns are dropped on import per the same decision.

---

## [3.10.0] - 2026-07-06

### Added
- **One-time data migration tooling, stage C (#320)** -- Import generators for loot, the M+ request history, and the officer audit log. Loot merges Pasted Loot and the legacy external tracker export, translates the base difficulty tier to Champion (per the decision on #320), derives legacy seasons from a date-ranges config, creates items rows for old-tier gear the Item Registry never knew, and dedupes on team-prefixed keys so a re-apply or a refresh export inserts only new rows. Audit rows keep their action text verbatim with the target/old/new/changed-by context folded into a jsonb detail blob. Timestamps convert from the spreadsheet's wall-clock timezone at apply time, so DST is Postgres's problem, not the generator's.

---

## [3.9.0] - 2026-07-06

### Added
- **One-time data migration tooling, stage B (#320)** -- Import generators for the three history tables. Attendance locates its columns by header text (the #228 cleanup changed the export layout), validates statuses against the schema's allowed list, and flags duplicate player/date rows; departed players referenced only by history import as archived stub rows. The BiS grid and priority ranking grid reshape from their wide sheet layouts into normal rows, with duplicate BiS cells collapsed and every item reference checked against the Item Lookup export before apply.

---

## [3.8.0] - 2026-07-06

### Added
- **One-time data migration tooling, stage A (#320)** -- New `scripts/import/` generators turn per-team CSV exports of the Google Sheet tabs into one reviewable, transactional SQL file per team (`node scripts/import/generate.js --team phoenix --season "..."`). This stage covers items + item_bosses (with a cross-team registry mismatch report), players (M+ exclusion state derived from approved requests, departed players kept as archived stubs so history FKs hold), and scoring. Re-applying a file inserts only new rows, so the pre-cutover refresh is a plain re-run. CSVs and generated SQL live in the new gitignored `data/` directory.
- **Natural unique keys on the reference tables** -- Migration adds `unique (class, spec)` on classes_specs and a unique index on `items (lower(name))`, giving the import SQL real ON CONFLICT targets. A double-applied import (SQL Editor or psql) now converges instead of duplicating reference rows; the classes-specs generator from #321 emits the matching conflict clause.
- **Import test suite** -- `npm run test:import` runs vitest unit tests for the CSV parsing, name normalization (diacritics, nicknames), SQL escaping, and per-table generators.

---

## [3.7.4] - 2026-07-05

### Added
- **Generated database schema docs** -- New `dbdoc/` directory with a markdown page and Mermaid ER diagram per table, generated from the migrations with [tbls](https://github.com/k1LoW/tbls) (`npm run db:docs`). A new schema-docs CI check fails any PR whose migrations no longer match the committed docs, so the diagrams cannot silently drift.
- **RLS policy reference** -- `docs/RLS.md` documents the row-level-security policy matrix for all 20 tables (tbls cannot introspect policies). CI requires it to be updated whenever a migration touches policy SQL. Writing it surfaced two policy defects on `player_wcl_season_perf`, filed as #293.
- **Raw RLS policy export** -- `docs/rls_policies.csv` holds every policy as one spreadsheet-friendly row, generated straight from `pg_policies` with `npm run db:rls`. CI regenerates it and fails the PR if the committed CSV is stale.

---

## [3.7.3] - 2026-07-05

### Changed
- **Split officer promotion out of the Discord Claims tab** -- The Roster tab's Discord Claims sub-tab showed Grant/Revoke Officer buttons alongside claim data, duplicating the Admin tab's Officers sub-tab. Discord Claims is now purely a read-only view of who claimed what character, with a consistent "Remove" action for every viewer (previously only non-admins had it). The Officers sub-tab now lists only current officers (with Revoke), plus a new "Promote a claimed character to officer" picker built from claimed users who aren't officers yet -- replacing the old free-text Discord ID field, which required knowing a raw ID that was never shown anywhere in the UI.

---

## [3.7.2] - 2026-07-05

### Fixed
- **Stale "Who are you?" label on the profile selector card** -- The public landing page's card only ever renders once someone's already logged in with Discord and claimed a character, so asking "who are you?" no longer made sense. Now reads "Your Profile" for raiders (just their own "View My Profile" button) and "Look Up a Raider" for officers (who get the full character dropdown).

---

## [3.7.1] - 2026-07-04

### Added
- **Public Roster tab** -- A new "Roster" nav item on the public landing page shows who's currently on the roster (name, class, spec) grouped by role, with no login required. Read-only -- no attendance, loot counts, or BiS data, and no edit controls (those stay behind the officer-only profile dropdown). Reuses the same class-badge styling as the officer BiS Lists tab.

---

## [3.7.0] - 2026-07-04

### Added
- **Signup mismatch confirmations for logged-in Discord users** -- If a signer is logged in with a claimed character, two new checks now catch likely mistakes before submission:
  - **Different Name-Realm than the claim** -- typed at Step 1, this is checked immediately, before any class/spec is picked. A typo can land on a genuinely different real character (e.g. typing `Katorri` when your claim is `Katorrí`, which happens to be someone else's actual character on the same realm), so this is no longer silently assumed to be an intentional main swap. Step 1 shows exactly what's claimed vs. what was typed, naming both characters, and requires an explicit confirmation before continuing. If confirmed, the claimed character is automatically recorded as the main-swap source later at submission -- no manual re-typing needed.
  - **Same Name-Realm, different class** -- the character's class can't actually change, so picking a class that doesn't match the claimed character's roster record is almost certainly a misclick. A confirmation checkbox naming both the recorded and selected class appears at the spec step and blocks progress until checked.
  - The original checkbox + manual Name-Realm entry (added in 3.6.8) is unchanged for signers with no claimed character on file.

---

## [3.6.9] - 2026-07-04

### Fixed
- **Main-swap checkbox not obvious as a checkbox** -- The "I'm switching mains this season" toggle used the hidden-input/pill-button style meant for grouped chip selections (like off-spec), so as a standalone full-width control it read as a static label rather than something clickable. It now renders as a visible native checkbox with a gold accent, matching the pattern used elsewhere on the site (e.g. the Pending Roster "remove absent" toggle).

---

## [3.6.8] - 2026-07-04

### Fixed
- **Main swap on the signup form was an auto-filled text box** -- The field silently pre-filled with the signer's own claimed character, making it look like everyone was swapping mains by default. It's now a checkbox ("I'm switching mains this season"). If the Discord user has a claimed character, it's shown read-only; otherwise a text box appears, validated with the same name-formatting rules as character names (catches malformed entries like `mmyumbeans - Illidan` before submission).

### Added
- **Pending Roster diff preview** -- The push banner now shows how many entries are new vs. updates vs. missing signups, computed against the live roster, before confirming a push.
- **Pending Roster conflict highlighting** -- Cards with a main swap get a highlighted border, a New/Update badge, and a note on whether the old character is still on the roster (so officers know if "remove absent" is needed to clean it up).
- **Pending Roster sort/filter controls** -- Role chips, a "Main Swap Only" toggle, and Name/Class sort for the pending entry list.

---

## [3.6.7] - 2026-06-29

### Added
- **Devotion Aura buff coverage tracking** -- Devotion Aura (provided by all Paladins) is now included in the raid buff coverage panel.
- **Signup history viewer** -- A new History sub-tab on the Signups tab shows all Roster Responses entries for the current signup season, grouped by status (Approved / Pending / Denied). Read-only reference view so officers can see the full signup picture alongside the active submission queue.

---

## [3.6.6] - 2026-06-29

### Fixed
- **Roster push overwrite bug** -- When multiple signups were pushed to the roster in one batch, any player whose role was stored as `DPS` or `Healer` (raw signup form values) was written to the sheet with an invalid role string. The next player's insertion point calculation skipped that row, causing them to be written to the same row and clobbering the previous player (root cause of Dayned being lost). The backend now resolves `DPS` and `Healer` to the correct `Melee`/`Ranged`/`Heal` value based on the player's main spec before writing to the roster.
- **Pure DPS class role defaulting to Melee** -- Warlock, Mage, and Rogue signups had no role radio buttons, but the resolved role defaulted to `Melee` for all of them. Each class now carries a fixed role in `CLASS_SPECS` (`Ranged` for Warlock/Mage, `Melee` for Rogue).
- **Hunter role not accounting for Survival (Melee)** -- Hunter previously defaulted to `Ranged`. Since Survival is a melee spec, Hunters now see a `Melee`/`Ranged` radio button on the signup form.
- **Hybrid DPS/Healer role not resolving at signup time** -- Players selecting `DPS` or `Healer` on the signup form now have their role resolved to the specific raid role (`Melee`, `Ranged`, or `Heal`) based on their selected main spec before the signup is submitted.

### Added
- **Character name validation** -- The public signup form and the officer Add Player modal now reject names that don't follow WoW naming rules: 2-12 characters, first letter capitalized, no additional capitals. Invalid names show an error with a corrected suggestion (e.g. "Did you mean Glizzygary?").

---

## [3.6.5] - 2026-06-29

### Added
- **Signup Season setting in Season Settings** -- Officers can now set the signup season label directly from the Season Settings tab. Previously the backend supported this but had no UI, meaning all signups were recorded with a blank season field. The field is now exposed, loaded on page open, and validates against empty saves.

---

## [3.6.4] - 2026-06-28

### Fixed
- **Attendance and WCL scores now pull from the Roster sheet** -- Player lists for attendance refresh, attendance score commit, WCL score refresh, and performance score commit were previously read from hardcoded rows 4-33 in the Scoring sheet (30-player cap). All four now source players directly from the Roster sheet, so anyone added to the Roster is automatically included. The Scoring sheet still stores scores per player but is no longer the source of truth for who is on the roster.

---

## [3.6.3] - 2026-06-28

### Fixed
- **Buff coverage styling** -- Buff names are now colored by their provider class (e.g. Druid orange for Mark of the Wild). Multi-class buffs (Heroism, Combat Res) remain white. Font size increased from ~0.77rem to 0.88rem on both the Roster and Pending Roster panels.

---

## [3.6.2] - 2026-06-28

### Fixed
- **Buff coverage not rendering on Roster tab** -- `buildRosterBuffCoverage` was only called in the heavy-data callback, so it never ran on initial load or after player saves. Moved the call into `buildOfficerDashboard` so it renders consistently.

---

## [3.6.1] - 2026-06-28

### Added
- **Buff/debuff coverage panel** -- Pending Roster tab now shows a collapsible Buff Coverage section (between Missing Signups and the Push area) with Raid Buffs, Boss Debuffs, and Utility grouped into three sections. Each buff shows a green checkmark (2+ players), yellow warning (1 player), or red X (not covered). Hovering a buff chip shows which players provide it.
- **Compact buff summary on Roster tab** -- A compact always-visible buff/debuff summary appears above the roster table, showing the same green/yellow/red indicators for the current active roster (bench excluded).

---

## [3.6.0] - 2026-06-28

### Added
- **3-stage roster signup flow** -- Signups are now a full season registration flow: players submit a signup (class/spec/role/discord/mainswap/notes), officers approve into a Pending Roster staging area, then push to the official roster in bulk when signups close.
- **Active signup season setting** -- A new Settings sheet stores a `signupSeason` key (e.g. `MN S1`) independent of the attendance season start date, so pre-season signups are attributed to the correct season. Officers set it via a new `setActiveSignupSeason` action.
- **Season stamping** -- Every signup submission and pending roster entry is now stamped with the active signup season.
- **Re-signup support** -- Approving a player who already has a Pending entry overwrites it rather than creating a duplicate, so players can update their class/spec before the push.
- **Missing signups** -- New `getMissingSignups` action (and `/missing-signups` bot command via bot issue #3) returns roster members who have not submitted a signup for the current season.
- **Push to Roster** -- New `pushPendingToRoster` action bulk-applies all Pending entries to the official roster (add new players, update existing class/spec/role). Optionally removes roster members not in the pending set.
- **Pending Roster tab redesign** -- Stats panel (total + role breakdown), collapsible missing signups section grouped by role, simplified cards with mainswap/season indicators, and a two-step Push to Roster confirm flow with optional remove-absent checkbox.

### Changed
- **Pending Roster sheet columns** -- Extended from 6 to 12 columns: Character-Realm, Class, Main Spec, Off Specs, Role, Discord, Mainswap, Notes, Season, Submitted At, Approved At, Status.
- **Approve signup** -- Removed the old duplicate-on-roster guard (players are expected to already be on the roster for season re-registrations). Now passes mainswap, notes, and season through to the Pending Roster sheet.
- **Officer.html help text** -- Updated Signups tab help to describe the push-based flow.

### Fixed
- **ESLint no-useless-escape** -- Removed unnecessary `\/` and `\-` escapes in two date-parsing regexes.
- **ESLint no-empty** -- Added `Logger.log()` bodies to previously-empty catch blocks.
- **ESLint no-redeclare** -- Converted `var` to `const`/`let` in `getItemRecipients` loops to eliminate cross-loop re-declarations.

---

## [3.5.5] - 2026-06-23

### Added
- **Supabase migration plan** -- Added `docs/supabase-migration-plan.md`, a proposal for moving the Raid Hub off Google Sheets to Supabase and PostgreSQL: phased roadmap, security model (Row Level Security as the access boundary), data migration approach, the loot-feed retirement, and the decisions and setup needed to begin. Planning only; no application changes.

---

## [3.5.4] - 2026-06-23

### Fixed
- **Grant/Revoke Officer and Remove buttons broken on Roster tab** -- Same double-quote collision as the Admin tab fix in 3.5.3; the Roster tab's Discord Claims section had identical unescaped `JSON.stringify` calls in its `onclick` attributes. Also fixes the Remove button (`removeDiscordClaim`) on the same row.

---

## [3.5.3] - 2026-06-23

### Fixed
- **Grant/Revoke Officer buttons broken in Admin tab** -- The onclick attributes used `JSON.stringify` to embed Discord ID and username, which wraps strings in double quotes. Because the attribute itself also uses double quotes, the browser truncated the attribute at the first inner `"`, leaving an incomplete JS expression that threw `SyntaxError: Unexpected end of input`. Replaced the inner quotes with `&quot;` HTML entities so the onclick is valid.

---

## [3.5.2] - 2026-06-23

### Fixed
- **"Invalid or expired session" when claiming a character on Hellfire Rollers** -- The Discord login popup could not read `sessionStorage` from the opener window, so it always called Phoenix's GAS backend to create the session. Claiming a character on Hellfire's page then failed because Hellfire's GAS had no record of the token. The team slug is now encoded directly in the OAuth `state` parameter so the callback knows which backend to call without any cross-window storage coordination.

---

## [3.5.1] - 2026-06-23

### Fixed
- **Discord session lost when switching teams** -- Switching to a different team via the nav dropdown now preserves your Discord login. Previously the per-team session key (`wga_discord_<slug>`) caused the new page to find no stored token, forcing a re-login. The session is now copied to the destination team's key before navigation.

---

## [3.5.0] - 2026-06-23

### Changed
- **"Who are you?" selector is now gated behind Discord login** -- The player selector card on the landing page is hidden unless the visitor is logged in via Discord with a claimed character. This prevents anonymous profile browsing now that Discord auth is live.
  - **Non-officers** see a "View My Profile" button that opens their own profile -- no dropdown.
  - **Officers** see the full player dropdown for browsing plus a "View My Profile" button.
  - **Unclaimed / not logged in** -- the card is hidden entirely.

---

## [3.4.2] - 2026-06-23

### Fixed
- **Officer quick-actions bar disappears on hard refresh** -- The bar now renders immediately from the cached Discord session in localStorage instead of waiting for the async token-validation JSONP call to complete. The validation callback still corrects the bar if the token has since been invalidated.

---

## [3.4.1] - 2026-06-23

### Changed
- **Officer quick-actions: attendance refresh links to dashboard** -- After a successful WCL attendance refresh from the index page quick-actions bar, the status message now includes a "Review in Dashboard" link that opens `officer.html` directly on the Attendance tab.
- **Officer dashboard: `?tab=` deep-link support** -- `officer.html?tab=attendance` (or any other tab name) now opens the dashboard with that tab active. Uses `openTab()`, a new programmatic helper that finds and clicks the correct sidebar nav button.

---

## [3.4.0] - 2026-06-23

### Added
- **Officer quick-actions bar on the index page** (#99) -- A compact bar appears below the site nav on the public roster page whenever a Discord-authenticated officer is logged in. Three actions are available without navigating to the full officer dashboard:
  - **Copy Priority Export** -- fetches the current priority export string from the backend and copies it to the clipboard in one click.
  - **Refresh Attendance** -- triggers a WCL attendance pull with inline progress and result feedback.
  - **Paste Loot** -- toggles an inline RCLootCouncil JSON paste form with the same chunked import logic as the officer dashboard loot import tab.
  - The bar shows/hides reactively on Discord login, logout, and session restore.

---

## [3.3.2] - 2026-06-23

### Changed
- **Attendance: auto-Bench players not in WCL log** -- Roster players who do not appear in the WCL log for a main raid night are now automatically marked `Bench` (source: `Auto`) instead of left blank. Officers can override individual rows to No Show / Excused as needed; manually set statuses are preserved on subsequent refreshes.

---

## [3.3.1] - 2026-06-23

### Changed
- **Attendance refresh: fewer WCL API calls** -- Three optimizations reduce the number of WCL queries on each pull:
  1. If `Season Start` is set, the initial report list query is filtered to that date (`startTime` param), so only current-season reports are fetched instead of the last 50 regardless of age.
  2. Reports whose date is already in the Attendance sheet skip zone + participant fetches entirely when either raid progression zone IDs are configured or a season start date is set (3 queries -> 0). When neither is set, only participant fetches are skipped (3 -> 1).
  3. Zone filtering now uses the zone IDs from the configured Raid Progression rather than heuristically detecting the "current" zone from the most recent report. This correctly handles mid-season tier additions (e.g. Sporefall in 12.0.7) -- any zone listed in the season's raid progression is treated as valid. Falls back to the previous heuristic if no progression is configured.
  - Typical re-run savings: a 10-night season with 8 nights already cached goes from ~30 WCL API calls to ~6.

---

## [3.3.0] - 2026-06-23

### Added
- **Attendance: exclude report from web app** -- Each raid night in the Attendance > Manage tab now has an "Exclude Report" / "Remove Exclusion" toggle button. Toggling updates column F of the Attendance sheet directly, immediately reflects in the night selector label (`[EXCLUDED]`), and writes an audit log entry.

---

## [3.2.0] - 2026-06-23

### Added
- **Audit log: officer identity** (#112) -- All officer-initiated actions now populate the "Changed By" column in the Audit Log with the officer's Discord username. The Discord token is auto-injected into every backend request when a Discord session is active. Discord Claims (user self-service) are marked "N/A" in that column since no officer performs the action.

---

## [3.1.0] - 2026-06-23

### Added
- **Signup: Main Swap field** (#181) -- Raiders switching mains can enter their current character (Name-Realm) on the signup form. If Discord-authenticated, the field pre-fills with their claimed character. Officers see the main swap on the signup card (highlighted in gold). On approval, the old character is automatically removed from the Roster sheet and their Discord claim is cleared.
- **Season archive: Roster snapshot** (#79) -- Archiving a season now captures a read-only snapshot of the roster (name, role, trial/bench status, join date, attendance %). Officers can expand a "View Roster" table for any archived season in the Season History tab.

### Fixed
- **Duplicate signup guard** (#180) -- Approving a signup for a character already on the Roster sheet now returns a descriptive error to the officer rather than silently creating a duplicate entry.

### Changed
- **Admin-only visibility** (#157) -- The team switcher dropdown in the nav bar is now hidden for non-admin officers (same gate as the Admin tab).

---

## [3.0.10] - 2026-06-23

### Fixed
- "My Profile" in the Discord nav dropdown now works on the officer dashboard. Clicking it navigates to the public roster page and automatically opens your character profile there.

---

## [3.0.9] - 2026-06-23

### Fixed
- Switching teams on the officer dashboard while Discord-authenticated no longer drops you to the password prompt on the new team. A "Continue with Discord" banner now appears at the top of the access prompt so you can re-authenticate with one click. The password form remains available below as a fallback.

---

## [3.0.8] - 2026-06-23

### Fixed
- Column headers in the Discord Claims and Officers tables now align with their data cells (headers were center-aligned by browser default while data was left-aligned).

### Added
- Discord Claims table now shows a Role column (Officer/Raider) for each claimed user.
- Admins see Grant Officer / Revoke buttons directly in the Discord Claims table; non-admin officers see only the Remove button.

---

## [3.0.7] - 2026-06-22

### Changed
- Discord login no longer auto-navigates to your character profile on login, session restore, or after claiming a character.
- A persistent **My Profile** entry now appears in the Discord nav dropdown (when a character is claimed) so you can navigate to your profile on demand.

---

## [3.0.6] - 2026-06-22

### Changed
- Discord Claims moved from Admin to a new subtab under Roster, accessible to all officers.
- Column widths in the Discord Claims table are now fixed to prevent content from spreading unevenly.

### Added
- Officer management UI in the Admin tab (Officers subtab). Admins can grant or revoke officer dashboard access per Discord user, or manually grant by Discord ID for users who have not yet claimed a character.
- Admin tab is now hidden from officers logged in via Discord; only users whose Discord ID is listed in the `adminDiscordIds` GAS Script Property can see it. Password login always shows Admin.
- `isOfficer` is now controlled by an explicit `officerDiscordIds` GAS Script Property rather than roster priority rank.

---

## [3.0.5] - 2026-06-22

### Changed
- Discord Claims moved from Admin to a new subtab under Roster, accessible to all officers.
- Column widths in the Discord Claims table are now fixed.

---

## [3.0.4] - 2026-06-22

### Added
- Discord Claims subtab under Admin on the officer dashboard. Shows all claimed characters with Discord username, character, and claimed date. Officers can remove a claim if a raider linked the wrong character -- the raider's active session is updated immediately and they will be prompted to re-claim on next login.

---

## [3.0.3] - 2026-06-22

### Fixed
- Claim character dropdown is now sorted alphabetically by Name-Realm.

---

## [3.0.2] - 2026-06-22

### Fixed
- Discord nav dropdown now anchors below the button instead of floating to the right edge of the screen.
- Nav dropdown shows a "Claim your character" option when logged in but no character has been claimed yet.

---

## [3.0.1] - 2026-06-22

### Fixed
- Claim character dropdown now shows `Name-Realm Class` instead of `Name-Realm (Class Spec)` -- drops spec and parentheses to reduce visual noise.
- Discord OAuth redirect URI corrected to match GitHub Pages URL casing (`WGA-Raid-Hub`). Fixes #166.

---

## [3.0.0] - 2026-06-22

### Added
- **Discord OAuth login.** Closes #25. Raiders and officers can now sign in with Discord -- the largest feature this app has shipped and the foundation for Phase 6 post-auth work.
  - **Login flow:** "Login with Discord" button in the site nav opens a popup. Discord redirects to a new `discord-callback.html` relay page on GitHub Pages, which forwards the authorization code to GAS server-side. The client secret never touches the browser.
  - **Session management:** GAS exchanges the code for a Discord access token, fetches the user profile, and creates a 30-day session token stored in `PropertiesService`. The frontend stores the token in `localStorage` (survives tab close and refresh).
  - **Character claiming:** On first login, a modal prompts the raider to select their character from the roster. One claim per Discord ID and one claim per character, enforced server-side. Claim is stored in a new "Discord Claims" sheet.
  - **Auto-redirect:** After login (or on page load with a valid session), the raider's own profile opens automatically -- no need to pick from the dropdown.
  - **Officer Discord login:** Officers whose claimed character has Raid Leader or Officer priority (1 or 2) bypass the password prompt entirely when logging in via Discord. The password prompt remains available as a fallback.
  - **Self-mark auto-approve:** When a Discord-authenticated raider submits a self-received item for their own character, GAS auto-approves it immediately instead of queuing it for officer review. Implements the long-standing TODO comment in the codebase. Partially closes #74.
  - **`discordClaims` in core payload:** The `chunk=core` response now includes a `discordClaims` array so the officer page can display and manage claims (officer claim management UI ships in #45).
- New GAS actions: `discordCallback`, `validateDiscordSession`, `claimCharacter`, `discordLogout`.
- New GAS helpers: `discordOAuthCallback`, `validateDiscordSession`, `claimCharacterForSession`, `isOfficerCharacter`, `ensureDiscordClaimsSheet`, `getDiscordClaims`, `generateSessionToken`, `discordTokenExchange`, `discordApiGet`.
- New files: `discord-callback.html`, `js/discord.js`.

### Setup required (before going live)
1. Create a Discord application at discord.com/developers. Enable `identify` scope. Register redirect URI: `https://katogaming88.github.io/WGA-Raid-Hub/discord-callback.html`.
2. Set `DISCORD_CLIENT_ID` (public) in `js/discord.js` (already set to the app client ID).
3. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` as Script Properties in both GAS deployments (Phoenix and Hellfire).

---

## [2.29.0] - 2026-06-22

### Added
- **Trial promotion improvements.** Closes #145.
  - Officers can now promote a trial player directly from the promotion alert with a "Promote" button on each row -- no longer need to navigate to the player profile.
  - Trial period duration and attendance threshold are now configurable in Season Settings and persisted to GAS script properties. Thresholds default to 4 weeks / 75% if not set.
- **Season Settings reorganised into subtabs.** Settings (name, dates, trial thresholds), Raid Progression, and History (archive + season history) are now separate subtabs instead of one long scroll. Card order also corrected: Season Name now appears before Start Date.

---

## [2.28.0] - 2026-06-22

### Added
- **Team switcher in officer dashboard.** A dropdown in the officer nav bar lets the admin switch between team deployments (Team Phoenix, Hellfire Rollers). Selecting a team saves to sessionStorage and reloads the page against that team's GAS backend. Auth is namespaced per team so switching prompts for the correct officer password automatically. Switcher is officer-page only -- not visible on the public roster.
- **Admin panel for super-admin.** A new Admin tab (officer page only) gives the admin full control over both team deployments:
  - **Properties Inspector** -- live read of all script properties (season name/dates, feature flags, bot URL, masked bot secret).
  - **Bot Config** -- set or clear the bot base URL and webhook secret via the officer UI without touching GAS directly.
  - **Data Export** -- one-click download of the full in-memory DATA object as a timestamped JSON file.
  - **Danger Zone** -- eight targeted destructive operations (clear season history, clear any data sheet) each requiring the admin to type the exact team name before executing.
- New backend GAS actions: `getAdminProperties`, `setBotUrl`, `setBotSecret`, `dangerClearSeasonHistory`, `dangerClearSheet`.

---

## [2.27.0] - 2026-06-22

### Added
- **Archived seasons view and unarchive capability.** Season History now shows rich cards (name, date range, raid count) in reverse-chronological order, each with an Unarchive button. Officers can restore any past season as the active season with a confirmation step -- the dialog warns if an active season would be overwritten. A new `unarchiveSeason` backend action handles the restore and logs it to the audit log. Closes #143.

---

## [2.26.0] - 2026-06-22

### Added
- **Priority over-allocation detection.** The Contested Items view now shows a warning banner listing any player who holds 1st priority on two or more item/difficulty combinations, helping officers spot over-allocation before loot decisions are made. Each affected player's chip in the item cards is also flagged with a red `!` badge. Closes #12.

### Fixed
- **Rank labels now display in Contested Items.** Player chips in the Contested Items view were never showing rank numbers (#1, #2, etc.) due to a bug where the per-difficulty priority object was treated as a flat array. Ranks now render correctly with a difficulty suffix (e.g. `#1H`, `#2M`).

### Changed
- **Contested Items moved from Loot tab to Priority tab.** It is a planning tool, not a loot history tool, so it now lives alongside Priority List and Unmanaged Items.
- **Priority subtabs reordered to match officer workflow.** New order: Contested Items -> Unmanaged Items -> Priority List (what's being fought over -> what still needs a decision -> what's been decided). Contested Items is now the default landing subtab when opening Priority.

---

## [2.25.0] - 2026-06-21

### Added
- **Active M+ exclusion list in officer tab.** The M+ Exclusions tab now shows a "Currently Excluded" section above the pending request queue, listing every player whose exclusion is active with their officer note. No extra network call -- populated from the already-loaded roster data on tab switch. Closes #149.
- **Rejection reason on raider card.** When an officer rejects an M+ exclusion request they are now prompted for an optional rejection reason (matching the existing approve note flow). The reason is saved to the sheet and shown on the raider's public card as a "Rejected" badge with the officer's note. If requests are open, the raider sees a Re-submit button. Closes #144.

---

## [2.24.0] - 2026-06-21

### Added
- **Champion (Normal) loot tier tracking in priority scoring.** The priority generator now recognises Normal-difficulty receipts from all three loot sources (Pasted Loot sheet, Loot Data IMPORTRANGE, and Self Received Requests). For Mythic priority, players with only a Normal receipt receive a 1.07x bonus (vs the 1.15x "No Version" bonus they incorrectly received before). For Heroic priority, Normal holders receive a 0.90x penalty and a "Has Champion" status label -- they are lower priority than players with no version, but still eligible. Self-received source prefixes "Champion:" and "Normal:" both route to the champion tier.

---

## [2.23.0] - 2026-06-21

### Changed
- **BiS List cleared on season archive.** When a season is archived via the officer dashboard, all player item columns (col B onwards from row 3) are now wiped so the sheet is ready for the next season's BiS lists. Slot labels and the player header row are preserved.

---

## [2.22.0] - 2026-06-21

### Changed
- **JSONP timeout handling across all data loading.** Added a `jsonpRequest(url, callback, timeoutMs)` helper to `common.js` (default 90s timeout, 120s for WCL refresh). All 50+ JSONP call sites across every officer tab now use this helper. If GAS hangs or is slow to respond, the request times out cleanly, re-enables the button, and shows "Request timed out. GAS may still be processing -- try again in a moment." instead of leaving the UI stuck indefinitely. Network errors show "Request failed. Check your connection."

---

## [2.21.0] - 2026-06-21

### Added
- **WCL Performance Scores tab** in the officer dashboard (`js/tabs/tab-scoring.js`). Officers can refresh WCL performance scores and commit them to the Scoring sheet without opening the spreadsheet.
- **Three scoring windows**: Recent (last 2 reports), Trend (last 8 reports), Best (last 20 reports). Scores are ilvl bracket percentile / 10, giving a 0-10 scale. Best Score uses the single highest percentile across all 20 reports rather than an average.
- **Inline score editing**: clicking any Recent Score cell opens a number input to manually override the value. The override is saved to the draft column (J) immediately via GAS and the cell updates in place.
- **"Use Best" button** on each Best Score cell copies the best score into the Recent Score column (both the spreadsheet draft and the in-page cache), so the next Commit will use the best score rather than the recent average.
- **Committed badge**: after committing, each eligible player's Recent Score cell shows a "committed" label so officers can see which scores have already been pushed to the Performance column.
- **sessionStorage caching**: scores are stored in `sessionStorage` after each refresh. Returning to the Scoring tab within the same browser session restores the table immediately with a "cached N mins ago" status, avoiding a redundant WCL fetch.
- **Color legend** always visible on the Scoring tab: green (>=7 Strong), gold (>=5 Average), dim (<5 Below average), purple (trend fallback), red (No data), muted (Excluded - Tank/Healer).
- **Healer exclusion from WCL scoring**: healers are now fully excluded from WCL data collection alongside tanks. Both roles are marked "Excluded" in the draft columns with a blue background.
- **Attendance-based scoring for tanks and healers** in the Priority Generator: instead of using the WCL performance score (col E), tanks receive `attendance * 0.50` and healers receive `attendance * 0.75` as their raw score, reflecting that these roles are not meaningfully ranked by DPS bracket percentile.

### Changed
- `refreshPerformanceScores()` and `commitDraftScores()` in `WCL.gs` now delegate to extracted core functions (`refreshWclPerformanceCore`, `commitPerformanceScoresCore`) so the same logic is callable from the web app without triggering `SpreadsheetApp.getUi()` alerts.
- `getRecentReports()` in `WCL.gs` now accepts a `limit` parameter instead of hardcoding 20, so all three scoring windows can share a single GQL fetch sliced in memory.
- `BEST_REPORTS = 20` added to `Config.gs` alongside existing `RECENT_REPORTS` and `TREND_REPORTS` constants.

---

## [2.20.0] - 2026-06-21

### Added
- **Multi-tenant support.** A single frontend now serves both Team Phoenix and Hellfire Rollers. The active team is selected via `?team=phoenix` or `?team=hellfire` URL param (defaults to `phoenix`) and persists in `sessionStorage` so dropping the param mid-session doesn't reset the team. Each team has its own GAS backend URL, team name, and officer password in the `TEAMS` config in `common.js`. Closes #136.
- **Team-scoped session storage keys** (`phoenix_officer` / `hellfire_officer`) prevent officer auth from bleeding between teams in the same browser.
- **Inter-page link passthrough.** Officer Access, Back to Roster, and Cancel links now carry the `?team=` param so navigation stays on the correct team.

### Fixed
- **Officer player card race condition.** Opening a player card then switching seasons triggered `buildRosterTable()` to wipe the inline card. Added `reopenSelectedPlayer()` which restores the card after every roster rebuild.
- **Loot not showing in officer view after copying spreadsheet.** Loot Data sheet entries were added to `lootCounts` without a season tag, so the season filter excluded everything. `getLootCounts()` now reads `seasonName` from Script Properties and tags Loot Data entries accordingly.

### Changed
- GAS web app file renamed from `PhoenixRosterWebApp.gs` to `wgaWebApp.gs`.
- Removed `REPORT_NAME_FILTER` constant — WCL report fetching now returns all guild reports without filtering by title, accommodating teams with inconsistent report naming.
- Changelog and footer links updated from `Phoenix-Roster` to `WGA-Raid-Hub` repo.

---

## [2.19.0] - 2026-06-20

### Added
- **BiS Manager tab** replaces the old BiS Submissions nav item. The tab now has two sub-tabs: Submissions (existing approve/reject workflow, unchanged) and BiS Lists. Closes #128.
- **BiS Lists sub-tab** shows all roster players grouped by role with their current item count. Clicking Edit on any player opens an inline editor below their row with: a list of their current BiS items (each removable), an item search/autocomplete field sourced from the Item Lookup sheet, and Save/Cancel actions. Saves write back to the BiS List sheet and invalidate the heavy cache.
- **Armor type filtering** in the BiS editor item search: results are automatically narrowed to items matching the player's armor type (Plate/Mail/Leather/Cloth derived from their class). Universal slots (Neck, Back, Ring, Trinket, Wrist, Cloak) and items with no armor type recorded are always shown regardless of class. Item Lookup col D = Armor Type; col E = Sort ID; col F = Boss.

---

## [2.18.0] - 2026-06-20

### Added
- **Raid Progression Tracker** on the public landing page. Displays all raids for the current season as side-by-side cards, each showing raid name, mythic kill count, progress bar, numbered boss list with first-kill dates, and an AOTC badge. Closes #80.
- **Raid Progression editor** in Season Settings. Officers can add multiple raids per season, each with a name, optional mini-raid flag (suppresses AOTC), AOTC date, and a list of bosses with individual mythic kill dates. Progression data is persisted in Script Properties and included in the core payload; archived seasons include their raid progression.
- **WCL auto-fill for boss kills.** Each raid card has a WCL Zone ID field and a "Fetch from WCL" button. Clicking it queries the WCL GraphQL API (using existing Script Property credentials) for all guild kills in that zone and populates boss names and first-kill dates automatically. Heroic kill of the last boss in range is used as the AOTC date.
- **Encounter ID range filter** per raid card (from/to fields). Allows multiple raids that share the same WCL zone ID (e.g. Midnight Season 1 zone 46) to be fetched independently by specifying which encounter IDs belong to each raid.
- **"List" button** per raid card that queries WCL for all encounters in a zone and displays their IDs and names inline, making it easy to look up the correct encounter range before fetching.

### Changed
- Landing page stat counters (Raiders, Items This Tier) moved above the character selector card.
- Landing page max-widths widened to accommodate the side-by-side progression layout (landing card 380px -> 500px, stats 380px -> 500px, loot 480px -> 760px, selector 360px -> 460px).

---

## [2.17.0] - 2026-06-20

### Added
- **Priority order management** from the officer dashboard. Dedicated Priority tab lists all items from the BiS sheet, split into Heroic and Mythic rows per item. Officers can drag-and-drop reorder, manually add players from the pool, or hit "Suggest Order" to auto-generate a ranked list. Closes #111.
- **Priority generator** scores eligible players by WCL performance × role multiplier (Tank ×0.50, Heal ×0.75, DPS ×1.00) with bench/trial penalties. Checks three loot sources (Pasted Loot, Loot Data, Self Received Requests) to exclude or penalize players who already have the item.
- **Heroic/Mythic prio split.** Each item has separate Heroic and Mythic priority rows in the Priority Order sheet (col A = difficulty). The generator handles them independently: heroic loot recipients are excluded from heroic prio and penalized ×0.85 on mythic; players with no version get a ×1.15 bonus on mythic prio; self-received/officer-marked items exclude the player from all prio.
- **"Mark Mythic received"** button on BiS list items. Players can submit a self-received request; officers can mark directly. Officers always see the button even when a receipt badge is already shown, so upgrading from heroic to mythic can be recorded. Any approved mark (officer or player) now counts as full exclusion from both prio tiers.
- Diacritic-insensitive name matching in the generator so players with accented names (e.g. Twañ) are correctly matched against loot records.

### Changed
- Priority generator no longer pads results to exactly 10 players -- the suggested list stops when there are no more eligible players.
- Priority tab count label no longer shows `/10`; shows the actual ranked count instead.
- **Unmanaged Items** badge and list now only clear an item once both Heroic and Mythic priorities have been saved. Previously, saving one difficulty removed the item from the unmanaged tab entirely. Partially-configured items now show individual "Set Heroic" / "Set Mythic" buttons for whichever difficulty is still missing.
- **Priority List** adds a "Hide empty" checkbox to the filter bar. When checked, individual Heroic/Mythic rows with no players assigned are hidden, reducing clutter without affecting rows that have rankings.
- **Suggest Order** results now display each player's weighted score and status label (e.g. `Score: 6.6 (Has Heroic)`) inline in the ranked list so officers can see the scoring rationale at a glance.
- A warning box now appears in the priority edit modal when a "Has Heroic" player is ranked above a "No Version" player in the suggested order. The warning updates live as players are reordered and disappears once the ordering is resolved.
- Fixed a crash (`SyntaxError: missing ) after argument list`) when clicking "Set Priority" or "Edit" on items whose names contain an apostrophe (e.g. "Vaelgor's Final Store"). `encodeURIComponent` does not encode `'`, so it is now explicitly percent-encoded to `%27` before being embedded in onclick handlers.

---

## [2.16.0] - 2026-06-19

### Added
- **Season selector** in the officer dashboard toolbar. A "Season:" dropdown filters loot counts, fairness, conflicts, and attendance to the selected season; "All Seasons" retains previous behavior. Defaults to the current season when one is configured. Hidden when no season data exists. Closes #115.
- **Season history store.** Officers can now archive the current season (Season Settings tab), pushing it to an immutable history list with start and end dates. Past seasons appear as options in the season selector. Season history is persisted in Script Properties and included in the core payload.
- **Season End Date** field in Season Settings. Officers can record when a season closes (independent of when the next one starts). Stored as `seasonEnd` in Script Properties.
- **Client-side attendance %** computed from raw per-raid records (`rawAttendanceData` in the heavy payload), replacing the server-computed value for any season other than "current". Replicates the join-date window logic from the backend. Bench fairness sub-tab also filters raid nights to the selected season's date window.

### Changed
- `getAttendanceDetails()` (heavy payload) now returns all-time penalty events without a season cutoff; the frontend filters them to the active season window when rendering the attendance scores list.
- Loot items in `getLootCounts()` now include a `season` field (from column A of the Pasted Loot sheet) to enable client-side season filtering.
- Season Settings tab redesigned into individual cards (Season Start Date, Season Name, Season End Date, Archive Season, Season History). Each card has its own `?` help button with a scoped inline tip, replacing the single cramped panel.

---

## [2.15.1] - 2026-06-19

### Added
- **Attendance trend sparkline on player profile.** The attendance section now shows a small SVG line chart, visible by default without clicking anything. When data spans more than one calendar month, each dot represents a month with the Y position reflecting average attendance that month (green >= 90%, blue >= 70%, yellow >= 50%, red below). When only one month of data exists, individual raid nights are shown instead. Hovering a dot shows an instant tooltip with the month, average percentage, and raid count (or exact date and status for per-night mode). Covers all season data with no cap. Closes #42.

---

## [2.15.0] - 2026-06-19

### Added
- **Bench Fairness sub-tab** on the Attendance tab. Shows how many times each raider has been benched, grouped by role (Tank / Heal / Melee / Ranged / Bench), sorted highest to lowest, with a bar chart and a raid-average reference line. Each row shows bench count and bench rate (benched / total raid nights appeared). Computed from the loaded attendance grid -- run "Refresh from WCL" first if no data appears. Closes #82.

### Changed
- Attendance tab: the Manage Raid Attendance panel (night grid, WCL refresh, Commit Scores) is now its own **Manage** sub-tab. The tab bar now reads **Manage | Attendance Scores | Bench Fairness**. Manage is the default. This prevents the night grid from consuming the full viewport when you just want to check scores or bench fairness.

---

## [2.14.2] - 2026-06-19

### Added
- Dedicated **Help tab** in the officer dashboard sidebar with a full workflow reference. Six step-by-step guides cover: importing RCLootCouncil loot history, refreshing attendance from WCL, manually editing attendance status, committing scores to the roster sheet, setting season start date and name, and the complete season reset workflow. Links within the guide jump directly to the relevant tab.

---

## [2.14.1] - 2026-06-19

### Added
- Contextual help tips on the officer dashboard: every major tab and sub-tab now has a `?` button that toggles an inline tip panel explaining the workflow. Covered sections: Roster, Priority, all four Loot sub-tabs (Import, Import History, Contested Items, Loot Fairness), Attendance, Signups, BiS Submissions, M+ Exclusions, Received Item Requests, and Season Settings (which also includes the full season reset checklist).
- Stat card hover tooltips: hovering any of the four summary cards at the top of the officer dashboard shows a short description of what the number counts.
- Items Distributed stat card now has a difficulty filter badge (All / Heroic / Mythic) in its top-right corner. Clicking it cycles through the three views without affecting card height or layout.

---

## [2.14.0] - 2026-06-19

### Added
- Officers can now edit a player's class, spec, and character name/realm directly from the player profile in the officer dashboard, without needing to delete and re-add the player. Class and spec save on dropdown change; name/realm changes require a Save button. Renaming a player migrates their officer notes to the new key automatically. All three changes are written to the audit log.

---

## [2.13.4] - 2026-06-19

### Added
- Loot Import is now its own dedicated sub-tab in the Loot tab, separate from Import History. Import History shows stored entry count, most recent date, and the Clear All action; Import shows only the paste form.

### Fixed
- "Clear All Loot History" button showed no feedback while the server request was in flight. It now disables and reads "Clearing..." until the response arrives.
- Unmanaged Items notification badge (sidebar and sub-tab) was always blank on page load because the badge was computed at core-payload-ready time, before the heavy payload (which contains priority and item slot data) had loaded. Badge is now also recomputed when the heavy payload arrives.

---

## [2.13.3] - 2026-06-19

### Fixed
- Loot dates still showed as raw strings after 2.13.2 because RCLC exports dates as `"2026/06/09"` and `String()` was passed through verbatim. The import frontend now parses `e.date` with `new Date()` and normalises it to `YYYY-MM-DD` before storing, so Google Sheets reliably converts it to a Date object and `Utilities.formatDate` formats both loot sources identically -- enabling cross-source deduplication to work. Existing imported data with bad dates should be cleared via Clear All and re-imported.

---

## [2.13.2] - 2026-06-19

### Fixed
- Attendance source column incorrectly labeled all players as "Officer" on any re-run of "Refresh from WCL". Root cause: the sheet-reader only preserved the status, not the source, so on rebuild every player with a prior entry was re-tagged Officer regardless of whether the entry originated from WCL or an officer edit. The reader now stores both status and source; sources are preserved faithfully across refreshes.
- "Refresh from WCL" success message auto-cleared after 6 seconds, leaving no indication the import completed if the officer wasn't watching. The message now stays visible until the next refresh.
- Loot import duplicated entries when the same RCLC JSON was re-imported (e.g. after clearing addon data and re-exporting, which resets local RCLC entry IDs). Deduplication now uses both the RCLC ID and a composite key (player + item + instance + date) so identical loot is skipped even if the ID changed between exports.
- Recent loot dates from the RCLC import displayed as raw JavaScript timestamp strings (e.g. "Tue Jun 09 2026 00:00:00 GMT-0400"). Google Sheets auto-converts date strings like `2026/06/09` to Date objects on write; the loot reader now formats them with `Utilities.formatDate` the same way the IMPORTRANGE loot path already did.
- Loot entries appeared doubled when both the `Loot Data` IMPORTRANGE sheet and the `Pasted Loot` sheet contained the same items. `getLootCounts` now deduplicates across both sources using a `player|item|date` key, reading Pasted Loot first so RCLC-imported entries take precedence.

---

## [2.13.1] - 2026-06-18

### Changed
- Self-mark received source options: replaced "World Drop" with "Bonus Roll"

---

## [2.13.0] - 2026-06-18

### Added
- Loot history import from the officer dashboard (#101). The Loot tab now has a third sub-tab, **Import History**, where officers can paste an RCLootCouncil JSON export directly into the web app.
  - Paste area accepts the standard RCLC JSON export (in-game: RCLootCouncil > Export > JSON). Works with any export size — one night, several nights, or the full season history.
  - Imports are **additive**: each paste appends new entries and automatically skips duplicates (deduped by the RCLC entry `id`). Re-pasting a night you already imported is safe.
  - Completion message reports how many entries were added and how many were skipped as duplicates.
  - The panel shows total entries stored and the date of the most recent entry.
  - **Clear All** button (with confirmation) wipes the imported history for use at a season reset.
  - Imported data is written to a new `Pasted Loot` sheet (created automatically) with columns: Season, RCLC ID, Player, Date, Item Name, Instance.
  - The season label applied to all imported entries is set once in the **Season Settings** tab (new Season Name field) rather than entered per import. The Import History tab shows the active season name and warns if none is configured.
  - `getLootCounts()` now reads from both the existing `Loot Data` sheet (IMPORTRANGE) and the new `Pasted Loot` sheet, merging results — no disruption to existing loot data.
  - Import and clear actions are logged to the Officer Audit Log and invalidate the heavy payload cache.

---

## [2.12.0] - 2026-06-18

### Added
- Attendance entry from the officer dashboard (#94). The Attendance tab now has a "Manage Raid Attendance" panel with three new capabilities:
  - **Refresh from WCL** button — triggers a full WCL fetch and rewrites the Attendance sheet without opening the spreadsheet. Shows a progress note ("This may take 30-60 seconds"), then displays a summary (X nights found, Y excluded) on completion.
  - **Night-by-night status grid** — after refresh (or on tab open if data exists), a dropdown lists every raid night. Selecting a night shows all roster players with their current status. Officers can change any status (Present / Bench / Medical Leave / Excused / No Show / Not on Roster) via a dropdown; each change auto-saves to the Attendance sheet and logs to the audit log.
  - **Commit Scores to Sheet** button — calculates attendance scores for all players and writes them to the Scoring sheet column D. Shows an inline confirmation banner before firing, then reports how many players were scored and over how many nights.
- `refreshAttendanceCore()` extracted from `refreshAttendance()` so the WCL fetch logic can be called from the web app without requiring spreadsheet UI.
- `commitAttendanceScoresCore()` extracted from `commitAttendanceScores()` for the same reason; the spreadsheet menu versions now delegate to these core functions.
- `getAttendanceSheetGrid()` backend function — reads the Attendance sheet and returns all raid nights with their full player/status list as JSON.
- `setAttendanceStatusInSheet()` backend function — finds a specific player/date row in the Attendance sheet and updates the status and source columns.
- Four new web app action handlers: `refreshAttendanceWCL`, `commitAttendanceScores`, `getAttendanceGrid`, `setAttendanceStatus`. All attendance mutations are logged to the Officer Audit Log.
- Attendance status editing from the player profile card. Expanding a player's attendance history now shows editable dropdowns on each row instead of static labels, allowing per-entry status changes without leaving the roster view. "Not on Roster" entries (pre-join-date raids) remain static labels. Changes save immediately with the same Saved/Error feedback as the grid.
- All attendance status dropdowns (night selector, grid rows, profile card rows) now show a gold `▾` chevron indicator so they are visually identifiable as interactive controls.
- Green `✓` checkmark on attendance grid rows where a status has been committed to the sheet (WCL-imported, auto-benched, or officer-entered). Rows with no status show no checkmark, making it easy to spot entries that still need to be filled in. The checkmark persists after saving a change in the current session.

---

## [2.11.1] - 2026-06-18

### Fixed
- Excused absences now carry a partial penalty (weight 0.8) in the webapp attendance percentage, matching the Scoring sheet formula. Previously Excused was treated as a full penalty (same as No Show), causing attendance % to be understated for players with excused absences.
- Players present in a WCL log but not in any ranked fight (e.g. joined mid-raid, sat out boss attempts) are now correctly detected as present. The combatants list (`masterData.actors`) is now always merged with rankings rather than used only as a last resort when rankings are completely empty.
- Players with "Not on Roster" entries no longer have those raids counted in their attendance denominator, fixing badly deflated percentages for mid-season additions (e.g. showing 26.9% instead of 100%).

### Changed
- Low-attendance threshold raised from 90% to 95% across the filter chip, attendance tab slider default, roster filter logic, and color bands.

---

## [2.11.0] - 2026-06-18

### Added
- Season start date setting in a new Season Settings tab on the officer dashboard. Officers can set (or clear) the date the current raid season began; the value persists in Script Properties and is included in the core payload for all clients.
- Mid-season join exclusion: raids between the season start date and a player's personal join date are excluded from their attendance penalty list and attendance percentage. The full attendance history view (expandable per-player) labels those excluded raids as "Not on Roster" in a greyed style so officers can still see the full timeline.
- Attendance percentage now computed directly from the Attendance sheet rather than the Scoring sheet formula, giving accurate per-player denominators that respect both the season start and each player's join date. Closes #107.
- Add Player modal now includes an editable Join Date field (defaults to today) so officers can backdate a player's join date at the time of adding them.
- Medical Leave attendance status with weight 1.0 (no penalty, same as Present). Appears in the Attendance sheet dropdown, displayed in light blue in both the sheet and the webapp attendance history view.
- "Sync % to Roster Sheet" button in the officer Attendance tab. Computes attendance % using the same logic as the player-facing display and writes the values directly to Roster sheet column C.
- WCL attendance import now fetches all reports for the Team Phoenix guild tag rather than filtering by report title. Fixes missing raid nights whose WCL log titles did not contain "Phoenix". Alt runs (title contains "Alt") are still excluded and appear in the Excluded section at the bottom of the Attendance sheet.
- WCL API credentials moved from Config.gs to Script Properties via a `setWCLCredentials()` helper, keeping them out of version control.

### Fixed
- Attendance % denominator now computed from player rows in the Attendance sheet rather than header rows. Header rows for some raids lacked a date in col A, causing those raids to be silently dropped from the denominator.

### Changed
- WCL queries scoped to Team Phoenix guild tag ID rather than the overall guild ID.
- Updated active tanks (added Adrestia, removed Hinda and Rothdar) and healers (added Kaya, removed Puddinpie) in Config.gs.

---

## [2.10.0] - 2026-06-18

### Performance
- Payload split into two separately cached JSONP chunks to eliminate load timeouts. A fast `?chunk=core` request (roster, toggle flags, bisAllowedPlayers, playerNotes) returns in under 1 second and lets both pages render immediately. A `?chunk=heavy` request (lootCounts, attendanceDetails, bisList, priorityOrder, itemSlots, selfReceived) fires right after and fills in loot counts, recent loot, BiS/priority content without blocking the visible render. Cache keys are invalidated precisely: roster mutations clear `rosterCore` only (300 s TTL); loot/BiS mutations clear `rosterHeavy` only (900 s TTL); the manual Clear Cache button clears both. Closes #104.

---

## [2.9.0] - 2026-06-18

### Added
- Join date per player tracked in Roster sheet column M. Automatically set to the current date when a player is added via the officer dashboard or approved from Pending Roster. Visible on the player profile (below the role/class badges) and in the officer roster table (below the class badge in the Player cell). Officers can manually set or correct a join date from the Player Settings panel on any profile. Changes are logged in the Officer Audit Log. Closes #77.
- Officer Audit Log now records an entry whenever an RCLootCouncil export string is generated from the Priority tab.

---

## [2.8.0] - 2026-06-18

### Added
- RCLootCouncil export string accessible directly from the Priority tab in the officer dashboard. A card at the top of the tab has a Generate button that rebuilds the export string on demand (same logic as the spreadsheet Export Priority Data function, minus the dialog) and displays it in a copyable text area. The freshly generated string is also written back to `Export!A11` to keep it in sync. No spreadsheet access needed. Closes #98.

---

## [2.7.3] - 2026-06-18

### Fixed
- Attendance history now sorts newest-to-oldest by date regardless of sheet row order.

---

## [2.7.2] - 2026-06-18

### Fixed
- Clicking anywhere inside the BiS List, Items Received, or Attendance sections no longer collapses them. The toggle is now scoped to the section header row only for all three sections.

---

## [2.7.0] - 2026-06-18

### Added
- Full attendance history per player in the officer profile panel. An "Attendance History" section appears below the attendance bar when viewing any player as an officer. On first click it fetches the complete date-by-date log (all statuses, not just penalties) via a new `getPlayerAttendanceFull` endpoint. Shows a summary line (e.g. "42 Present, 2 Late, 1 No Show") followed by a scrollable list newest-first, colour-coded by status. Result is cached for the session so subsequent toggles don't re-fetch. Closes #14.

---

## [2.6.1] - 2026-06-17

### Changed
- Class/spec badge on the player profile and officer roster now shows spec name only (e.g., "Demonology" instead of "Warlock - Demonology"); badge color remains the class color. Falls back to class name if no spec is set. Officer roster badge now uses the same pill styling as the profile header.

---

## [2.6.0] - 2026-06-17

### Added
- "Fully BiS" badge on the player profile header -- appears automatically when a player has received every item on their BiS list (from any source: raid loot, M+, crafted, etc.). Visible to both raiders and officers. Closes #40.

---

## [2.5.0] - 2026-06-17

### Added
- Officer action audit log -- every officer mutation is now recorded in an append-only "Officer Audit Log" sheet. Covers: player add/remove, role/spec/trial/bench changes, BiS approvals/rejections/direct updates/submission toggles, signup approvals/denials, self-received approvals/rejections, loot direct-marks, M+ exclusion toggles/approvals/rejections/bulk-clear, officer note changes, and open/close toggles for signups, BiS submissions, and M+ exclusions. Closes #83.
- Dedicated Audit Log tab in the officer dashboard with Time, Changed By, Action, Target, From, and To columns. URLs (e.g. BiS links) render as truncated clickable links. Live search filter across officer, action, and player name.
- "Changed By" column schema in place for when Discord OAuth ships -- blank for now, wired up and ready (#25).

---

## [2.4.3] - 2026-06-17

### Added
- Pending action count badges on officer tab nav buttons -- Signups, BiS Submissions, M+ Exclusions, and Received Item Requests each show a red count badge when items need attention; Signups badge combines open signups and pending roster entries, with a separate badge on the Pending Roster sub-tab. Badges load on dashboard open and refresh automatically after any approve/reject action. Closes #76.

---

## [2.4.2] - 2026-06-17

### Added
- Last received item highlight on the player profile -- shows the most recent loot upgrade(s) prominently with item name colored by difficulty, date, and a gold accent, always visible without expanding the full history. Groups multiple items received on the same night. Closes #41.
- Date now shown on every entry in the expanded Items Received list alongside slot and difficulty.

---

## [2.4.1] - 2026-06-17

### Added
- BiS completion percentage in the player profile header -- shows percentage complete and received/total count, calculated from raid loot history and self-reported items. Closes #39.

---

## [2.4.0] - 2026-06-17

### Added
- Unmanaged Items sub-tab on the Priority tab -- lists all items with no players ranked yet, grouped by slot type with collapsible armor sub-sections (Head, Shoulders, etc.). Closes #13.
- Red notification badge on the Priority sidebar nav button and on the Unmanaged Items sub-tab chip showing the count of unmanaged items; badge appears immediately on dashboard load.
- Armor slot sub-sections (Head, Shoulders, Chest, etc.) are now individually collapsible on both the Priority List and Unmanaged Items tabs.

---

## [2.3.1] - 2026-06-16

### Fixed
- Version number now appears in the footer on the profile and signup views (was only shown on the landing view).

### Changed
- Player card section labels renamed for clarity: "BiS Checklist" -> "BiS List", "BiS Link" -> "BiS Source".
- M+ Exclusion section moved below BiS List on the player card.

---

## [2.3.0] - 2026-06-16

### Added
- M+ Excl. column on the officer roster table with a green checkmark for excluded players, matching the BiS Link column style.
- Officer direct mark received: when an officer marks an item as received from the player profile, it is approved immediately without going through the approval queue. The source badge and green row highlight appear inline without a reload.
- Mark received button now shows on M+, Crafted, and Catalyst BiS rows (previously hidden). Source dropdown is pre-selected to match the known source.
- Player Settings section in the officer profile is now collapsible, starting collapsed. Clicking the section label expands or collapses it without affecting the controls inside.

### Changed
- Officer dashboard tab layout restructured: Contested Items and Loot Fairness merged under a single Loot tab with sub-tabs. Priority remains a standalone tab. Received Item Requests moved to the bottom of the sidebar.
- Signups and Pending Roster are now sub-tabs within the Signups tab rather than separate sidebar entries.
- Player profile in the officer roster now opens as an inline row directly below the clicked player instead of at the bottom of the page. Clicking the same player again closes it.
- Toggling M+ exclusion from the officer profile now immediately updates the M+ Excl. column in the roster table without requiring a reload.
- Expand/collapse hints changed from "tap to" to "click to" throughout the officer profile.

---

## [2.2.0] - 2026-06-16

### Added
- Signup approve/deny: officer approve writes applicant to Pending Roster sheet and marks status in Roster Responses; deny marks the row as Denied. Status badges shown on all signup cards.
- Pending Roster tab in the officer dashboard: lists approved applicants awaiting formal roster placement, with Add to Roster (pre-fills the Add Player modal) and Remove buttons.
- M+ Exclusion system: raiders submit a Raider.io profile link from their character profile to request exclusion from dungeon loot consideration. Officers open/close the form via a toggle in the M+ Exclusions tab.
- Discord bot notifications for M+ exclusion submissions via the `/mplus` endpoint.
- M+ exclusion status derived entirely from the M+ Exclusion Requests sheet (approved rows) merged with a ScriptProperties manual override list -- no Roster sheet column required.
- Officer can manually mark or unmark any player as M+ excluded from the Player Settings section of their profile (button toggle matching Trial/Bench pattern).
- Optional officer note on M+ exclusion approvals -- officer enters a note before confirming approval; note is stored in column 6 of the M+ Exclusion Requests sheet and shown in italic on the raider's profile below the Excluded badge.
- Clear All Exclusions button in the M+ Exclusions tab for season resets -- removes all manual exclusions and resets all Approved rows to Reset in the sheet. Requires a two-step confirm.
- M+ Excl. column on the officer roster table with a green checkmark for excluded players, matching the BiS Link column style.

### Fixed
- Add to Roster in the Pending Roster tab was silently failing because `prompt()` is blocked in GAS iframes -- replaced with an inline nickname form using `addEventListener`.
- Approve/Cancel buttons in the inline nick prompt were unresponsive -- root cause was two child divs inside a `display:flex` row parent; fixed by wrapping injected HTML in a single `width:100%` container.
- Player added from Pending Roster did not appear in the roster tab until a full reload -- `buildRosterTable()` and `buildStatsBar()` are now called immediately on success.
- Approved signups reappeared when switching back to the Signups tab because `buildSignupsTab()` re-fetches on every switch -- approved entries are now filtered client-side before rendering.
- Officer view showed two M+ exclusion sections (profile section and Player Settings button) simultaneously -- M+ exclusion profile section is now suppressed when `backTo === 'officer'`.

---

## [2.1.0] - 2026-06-15

### Added
- Discord notifications via the team-phoenix bot for all three raider submission actions: raid signup, self-received item request, and BiS list submission
- `sendToBot()` helper in `PhoenixRosterWebApp.gs` posts to `/signup`, `/selfreceived`, and `/bis` endpoints on the bot after each write

---

## [2.0.6] - 2026-06-15

### Reverted
- Removed mobile overflow hiding and roster table scroll wrapper -- the officer dashboard is desktop-first and the overflow-x:hidden approach was clipping UI elements. PR #67 toolbar/nav improvements are kept.

---

## [2.0.5] - 2026-06-15

### Fixed
- Mobile horizontal scroll: apply `overflow-x:hidden` to both `html` and `body` -- setting it on `body` alone allows browsers to transfer the scroll to the `html` element

---

## [2.0.4] - 2026-06-15

### Fixed
- Page-level horizontal scroll on mobile suppressed; only the roster table container scrolls horizontally

---

## [2.0.3] - 2026-06-15

### Changed
- Roster table on mobile: BiS Link column hidden to reduce width; table wrapped in a horizontal scroll container so only the table scrolls, not the whole page

---

## [2.0.2] - 2026-06-15

### Changed
- Officer dashboard switched back to centered layout at `max-width:1600px` so the header and content share the same centre column on wide screens
- Officer mobile layout: toolbar now stacks title above buttons (no more mid-word button wrapping); nav tabs replaced wrapping rows with a single horizontal scroll strip

---

## [2.0.1] - 2026-06-15

### Added
- Landing page stats row: Raiders count and Items This Tier, displayed below the selection card
- Landing page Recent Loot: last 10 items distributed across all players, sorted by date, showing player name, item, difficulty badge, and date
- Clicking the header on any page navigates back to the roster

### Changed
- Officer dashboard is now left-aligned so the sidebar sits near the left edge on wide screens; max-width raised to 1400px
- Landing content wrapped in a card panel (dark background, gold top accent border) for visual presence on wide screens
- Header subtitle changed from "Loot Priority" to "Raid Hub" on both pages
- Officer Access link moved to the bottom of the landing card
- Version number now appears in the `index.html` footer

---

## [2.0.0] - 2026-06-15

### Changed
- Split monolithic `app.js` (2130 lines) into 12 focused modules: `common.js`, `roster.js`, `signup.js`, `officer.js`, and 8 tab-specific files under `js/tabs/`
- Officer panel moved to a dedicated `officer.html` page; `index.html` now serves public views only (roster, profile, signup)
- Officer password gate now appears immediately on `officer.html` load -- no data is fetched until authentication succeeds
- Officer sessions expire after 2 hours; re-visiting the page after expiry prompts for the password again
- `css/officer.css` stub added for a future officer-styles split pass

---

## [1.8.0] - 2026-06-15

### Added
- Items Received on player profiles now shows the slot and difficulty for each item
- Slot label uses the same color coding as the BiS priority list
- Tier token names (e.g. "Voidcast Fanatical Nullcore") resolve correctly via prefix match against Item Lookup, handling the armor-type suffix added in the sheet

---

## [1.7.0] - 2026-06-15

### Added
- Officer profile view: "Player Settings" section to change a player's role, trial status, and bench status without editing the sheet directly
- Role change also updates the Priority column (Tank=3, Heal=4, DPS=5); Raid Leader and Officer priorities (1-2) are left untouched
- Bench toggle writes priority 6 when benching; derives the correct priority from the player's role when un-benching
- Officer notes per player -- free-text, stored server-side, visible only in the officer dashboard

### Changed
- "Requests" nav tab renamed to "Received Item Requests" for clarity

---

## [1.6.0] - 2026-06-15

### Added
- BiS list URL submission built into the webapp -- raiders submit from their character profile (replaces the Google Form)
- Officers can open/close BiS submissions globally from the new "BiS Submissions" officer dashboard tab
- Officers can grant per-player BiS submission access from the raider's profile card, independent of the global toggle
- Per-player access is automatically revoked after the player submits
- Officer profile view: "Update BiS Link" form to set a player's BiS URL directly without the approval queue
- BiS Submissions tab: pending submissions listed as cards with Approve and Reject buttons; approving writes the URL to the Roster sheet
- Apps Script: setBisSubmissionsOpen, submitBiS, getPendingBiS, approveBiS, rejectBiS, updateBisLink, allowBisForPlayer, revokeBisForPlayer actions; bisSubmissionsOpen and bisAllowedPlayers included in buildPayload

### Changed
- Muted and dim text colors lightened (--text-muted: #c4bdb2, --text-dim: #aea9a0) for better readability on dark backgrounds
- Base font size increased to 18px with a comprehensive rem-scale bump across all small text
- Stat card number size reduced to 1.8rem; stat label to 0.8rem to prevent oversizing at new base
- Officer sidebar tab text reduced to 0.82rem

---

## [1.5.0] - 2026-06-15

### Added
- Raiders can mark BiS items as received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) directly from their character profile
- Inline source picker form expands per item -- source required, notes optional
- Submissions go to a new "Self Received Requests" sheet with status Pending/Approved/Rejected
- Officer dashboard: new "Requests" tab lists all pending requests with Approve and Reject buttons
- Approving a request busts the roster cache and shows a gold source badge on the player's profile
- Apps Script: requestSelfReceived, getPendingRequests, approveRequest, rejectRequest actions; getSelfReceived included in buildPayload
- TODO(auth) markers in both Apps Script and JS indicate where Discord OAuth will bypass officer approval

### Notes
- Self-reported items are excluded from Loot Fairness -- that tab reflects RCLootCouncil raid distributions only

---

## [1.4.0] - 2026-06-15

### Added
- Season signup form -- multi-step flow (character/realm, class grid, spec/off-specs/role, Discord/notes, confirmation) accessible from the landing page
- Custom realm combobox with live filtering across all NA and OCE realms
- Off-spec checkboxes exclude whichever main spec is selected and update live on change
- Role selector shown only for hybrid classes (Death Knight, Demon Hunter, Druid, Evoker, Monk, Paladin, Priest, Shaman, Warrior)
- Officers can open/close signups from the Signups tab -- state persists server-side via Apps Script ScriptProperties and is reflected in the landing page CTA
- Submissions are written to a "Roster Responses" sheet (auto-created if missing)
- Officer Signups tab fetches and displays all submissions as cards, newest first
- Delete button on each submission card -- removes the row from the sheet and the card from the DOM without a full reload
- Clear Cache button in the officer dashboard toolbar
- Color-coded class and spec display on player profiles and the roster table

### Changed
- Apps Script write pattern established: GET-based `?action=...` JSONP calls handle all writes (`submitSignup`, `deleteSignup`, `setSignupsOpen`) -- no POST endpoint required

---

## [1.3.0] - 2026-06-14

### Added
- Officer view sidebar navigation — vertical nav replaces flat tab bar, sticky on desktop and collapses to horizontal row on mobile
- Stats bar at the top of the officer dashboard showing Raiders count, Avg Attendance, Items Distributed, and BiS Submitted ratio
- "Data as of HH:MM" timestamp in the officer toolbar showing when the roster was last fetched
- Attendance tab threshold slider — filter players at or below any attendance %, defaulting to 90%
- Priority tab item search — live filter across all items by name
- Collapsible priority sections — click any section header (Trinkets, Armor, Weapons, etc.) to collapse or expand
- Loot Fairness difficulty filter — All / Heroic / Mythic chips filter the bar chart and average line
- Average line marker on the Loot Fairness chart with a legend showing the roster average item count
- "Received (Heroic)" / "Received (Mythic)" badge on contested items for players who already got that item, with strikethrough styling
- Difficulty shown per item in player profile Items Received section
- Backend: `lootCounts` now includes `heroicCount`, `mythicCount`, and per-item `difficulty` field

### Changed
- Loot Fairness bars are now grouped by role (Tanks / Healers / Melee / Ranged / Bench) with coloured section headers
- Loot Fairness bars increased from 6px to 10px height
- Roster attendance column now shows a mini progress bar below the percentage
- Roster player avatars now use a solid 2px role-coloured border
- Search bars moved above filter chips on the roster tab for better flow
- "BiS Conflicts" tab renamed to "Contested Items"

---

## [1.2.0] - 2026-06-14

### Added
- Priority tab in the officer dashboard — full ranked list for every item, grouped by type (Trinkets, Armor by slot, Weapons, Jewelry)
- Player names in priority lists are role-coloured with a role badge (TANK / HEAL / MELEE / RANGED) to the right
- By Raid sort placeholder (disabled until raid source data is available)

---

## [1.1.0] - 2026-06-14

### Added
- Sort chips on the officer roster (Name / Attendance / Items) — clicking twice reverses order
- Player name search filters the roster live as you type
- BiS item search filters roster to players who have a specific item in their BiS list, with a player count badge
- Role filter chips on the officer roster (Tank / Healers / Melee / Ranged) — clicking a second time deselects
- CHANGELOG, CONTRIBUTING, PR template, issue templates, ROADMAP, .gitignore, and VS Code workspace settings

---

## [1.0.0] - 2026-06-14

### Added
- Raider view: character select, attendance bar, items received, BiS link, loot priority table
- Officer dashboard with password login (session-scoped)
- Roster tab: full player table with attendance, items received, BiS link status, trial/bench tags
- Roster filters: Low Attendance, No BiS Link, Trials Only, Bench Only
- Expandable player profiles inline in the officer roster
- BiS Conflicts tab: raid items sorted by how many players want them, with priority ranks
- Loot Fairness tab: bar chart of items received per player, coloured by role
- Attendance tab: players below 90% sorted lowest first with penalty dates
- 5-minute server-side cache via Google Apps Script with manual clear option
