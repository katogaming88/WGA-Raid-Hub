# Changelog

All notable changes to Phoenix-Roster will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
