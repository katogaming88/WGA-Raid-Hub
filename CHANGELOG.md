# Changelog

All notable changes to Phoenix-Roster will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
