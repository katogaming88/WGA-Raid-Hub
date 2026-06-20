# Phoenix Roster

A live web app for Team Phoenix -- a full raid hub giving raiders a personal profile and officers a complete management dashboard, all driven by the Phoenix Loot Priority Google Sheet.

---

## What it does

### Landing page (public)

- Character selector dropdown -- choose your character to open your profile
- Stats row showing current Raiders count and total items distributed this tier
- Recent Loot feed showing the last 10 items distributed across the roster
- Raid Progression tracker showing all raids for the current season as cards with kill counts, boss lists, first-kill dates, and AOTC badge

### Raider profile (public, no login)

- **Attendance** -- full-tier attendance percentage with a colour-coded progress bar and monthly sparkline, expandable to show any Excused/No Show dates
- **Items Received** -- total items received this tier, expandable to show the full list with slot and difficulty
- **BiS List** -- link to the player's submitted BiS list; submit or update directly from the profile
- **Loot Priority** -- every BiS item with the player's current priority rank, slot, and source
- **Self-mark received** -- submit items received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) for officer approval

### Season signup (public)

Multi-step signup form accessible from the landing page. Officers can open or close signups from the officer dashboard.

### Officer dashboard (`officer.html`)

Officers enter a password on page load (session lasts 2 hours). The dashboard has 11 tabs with a global season selector to filter loot, fairness, and attendance to a specific season:

| Tab | Sub-tabs | What it shows |
|-----|----------|--------------|
| **Roster** | -- | Full player table with attendance, items, BiS status, trial/bench tags. Filter by role, attendance, BiS, or trial/bench. Sort by name, attendance, or items. Click a player to expand their full profile inline with edit controls. |
| **Loot** | Import / Import History / Contested Items / Loot Fairness | Import: paste RCLootCouncil JSON to write loot to the sheet. Import History: view previously imported batches. Contested Items: every raid item sorted by how many players have it on their BiS, with each player's priority rank. Loot Fairness: bar chart of items received per player, filterable by Heroic or Mythic. |
| **Priority** | Priority List / Unmanaged Items | RCLootCouncil export string generator (generate and copy to clipboard). Priority List: full priority order per item, filterable by boss and searchable; each item has a Priority Generator button to auto-rank players by blended score with an editable, saveable order. Unmanaged Items: BiS items with no priority order yet assigned, with badge count. |
| **BiS Manager** | Submissions / BiS Lists | Submissions: open/close BiS submissions globally or per player; approve or reject submitted links (approving writes the URL to the Roster sheet). BiS Lists: role-grouped player table; Edit opens an inline item editor with the player's current BiS items, BiS source link, and armor-type-filtered item search/autocomplete. |
| **Attendance** | Manage / Attendance Scores / Bench Fairness | Manage: attendance grid editable per player per night; Refresh from WCL pulls latest raid nights; Commit Scores writes attendance % to the Scoring sheet. Attendance Scores: players below a threshold (adjustable slider), sorted lowest first. Bench Fairness: bench player attendance comparison. |
| **Signups** | Signups / Pending Roster | Signups: open/close the public signup form; review, approve, or deny signup submissions. Pending Roster: approved applicants waiting to be added to the roster. |
| **M+ Exclusions** | -- | Review and approve or reject M+ exclusion requests submitted by raiders. Toggle exclusion per player manually. |
| **Received Item Requests** | -- | Approve or reject raider self-mark requests. Approving writes the item to their loot history. Officers can also mark items received directly from the Roster tab player card. |
| **Season Settings** | -- | Season Start Date (attendance window start), Season Name (applied to imported loot), Season End Date (optional close date), Raid Progression (boss kill dates shown publicly), Archive Season (pushes season to history and resets settings), Season History (list of past seasons). |
| **Audit Log** | -- | Append-only log of every officer action -- player changes, approvals, loot marks, status changes -- with timestamp, actor, action, target, and old/new values. Live search filter. |
| **Help** | -- | Officer workflow reference guide covering common tasks. |

Officer controls on the Roster tab (player card):
- Add or remove players directly from the page
- Change class, spec, role, trial status, bench status, or join date per player
- Rename a player (Name-Realm)
- Free-text officer notes per player (stored server-side, officer view only)
- Update a player's BiS link directly without the approval queue
- Allow a specific player to submit a BiS update outside an open window
- Mark items received directly (bypasses the approval queue)

---

## File structure

| File | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `js/common.js` | Shared globals, `WEB_APP_URL`, `VERSION`, data helpers, `renderProfile` |
| `js/roster.js` | Public page boot, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, password gate, session expiry, tab dispatch |
| `js/tabs/tab-*.js` | One file per officer tab (14 files) |
| `css/styles.css` | All styles |
| `css/officer.css` | Stub for officer-specific styles (future split) |
| `gs/PhoenixRosterWebApp.gs` | Apps Script -- reads the sheet and serves data as JSON (web app endpoint) |
| `gs/Config.gs` | Shared constants -- sheet names, column indices, WCL credentials |
| `gs/Menu.gs` | Spreadsheet menu definitions (`onOpen`) |
| `gs/Export.gs` | RCLootCouncil priority export -- builds and base64-encodes the import string |
| `gs/Dropdowns.gs` | Priority Order and BiS List dropdown management |
| `gs/WCL.gs` | WarcraftLogs API -- fetches performance scores and writes draft/trend columns |
| `gs/Attendance.gs` | WCL attendance fetch, sheet writer, and score commit |
| `gs/PriorityGenerator.gs` | Blended priority score calculator for the Priority Generator |
| `gs/LootReceived.gs` | Difficulty-aware loot tracking -- highlights received items in Priority Generator |
| `gs/PriorityLegend.gs` | Writes the scoring key/legend to the Priority Generator tab |
| `gs/About.gs` | Rebuilds the About tab in the spreadsheet |
| `gs/Utils.gs` | One-off utilities (e.g. set BiS List validation to warn-only) |

---

## How it works

1. The **Google Sheet** is the source of truth -- officers update the Roster, BiS List, Priority Order, Scoring, and Loot Data tabs as normal
2. The **Apps Script** (`PhoenixRosterWebApp.gs`) reads those tabs and returns a JSON payload via JSONP when either page loads
3. `index.html` and `officer.html` fetch that payload on load and render all views dynamically -- no page reloads
4. Both pages are hosted on **GitHub Pages** at the repo root

Data is split into two cached payloads: core (roster, settings -- 5 min cache) and heavy (BiS lists, item data, loot counts, attendance -- 15 min cache). Use **Clear Cache** in the officer dashboard toolbar to force a refresh after sheet changes.

---

## Setup

### 1. Google Apps Script (one time)

1. Open the Google Sheet -- **Extensions > Apps Script**
2. Create a script file for each `.gs` file in the `gs/` folder and paste in the contents
3. **Deploy > New Deployment** -- Type: Web App, Execute as: Me, Access: Anyone
4. Copy the Web App URL (`https://script.google.com/macros/s/.../exec`)
5. Open `js/common.js` and paste the URL into `var WEB_APP_URL = '...'`
6. Open `js/officer.js` and set `var OFFICER_PASS = '...'` to your officer password

### 2. GitHub Pages (one time)

1. Push all files to your GitHub repo
2. **Settings > Pages > Deploy from branch > main / root**
3. Your public URL will be `https://yourusername.github.io/repo-name`

### 3. Roster tab columns

| Col | Header |
|-----|--------|
| A | Has 1st Prio - S2 |
| B | Is Trial |
| C | Attendance % (formula) |
| D | Player (Name-Realm) |
| E | Nickname |
| F | Class |
| G | Spec |
| H | Role |
| I | BiS Link |
| J | Sort Key (auto) |
| K | Priority |
| M | Join Date (YYYY-MM-DD) |

Paste the formula from `AttendanceFormula.txt` into **C4** and drag down. Format column C as custom number format `0"%"`.

### 4. Item Lookup tab columns

| Col | Header |
|-----|--------|
| A | Item Name |
| C | Slot |
| D | Armor Type (Plate / Mail / Leather / Cloth -- leave blank for weapons, shields, off-hands, tokens) |
| E | Sort ID |
| F | Boss |

See issue #132 for the full workflow for populating this sheet from Wowhead each tier.

---

## Officer workflows

| Task | What to do |
|------|-----------|
| Player joins | Use Add Player in the Roster tab, or add to the sheet then Clear Cache |
| Player leaves | Use Remove Player in the Roster tab |
| Role / trial / bench / class / spec / join date change | Edit inline from the player card on the Roster tab |
| Rename a player | Use Rename in the player card on the Roster tab |
| BiS link submitted | Approve from BiS Manager > Submissions (writes to sheet automatically) |
| Edit a player's BiS items directly | BiS Manager > BiS Lists > Edit |
| Loot imported | Loot > Import -- paste RCLootCouncil JSON; entries are tagged with the current season name |
| Priority updated | Priority tab > Priority Generator button per item; edit and Save |
| RCLootCouncil sync | Priority tab > Generate export string; copy and paste in-game |
| Attendance refreshed | Attendance > Manage > Refresh from WCL, then Commit Scores to Sheet |
| New tier starts | Repopulate Item Lookup sheet -- see issue #132 |
| Season rollover | Season Settings -- see Archive Season rollover workflow and issue #131 |

---

## Redeploying the Apps Script

Only needed when `PhoenixRosterWebApp.gs` itself changes -- not for sheet data changes.

1. Apps Script > **Deploy > Manage Deployments**
2. Click the pencil icon on the existing deployment
3. Set version to **New version**, then **Deploy** -- the URL stays the same

---

## Sheet tabs read by the Apps Script

| Tab | What's read |
|-----|------------|
| Roster | Player list, roles, trial/bench status, BiS links, class/spec, sort key, join date |
| Scoring | Attendance scores (column D) |
| BiS List | Each player's BiS items per slot |
| Priority Order | Ranked player lists per item and difficulty |
| Item Lookup | Item names, slot types, armor types, sort IDs, and boss sources |
| Loot Data | All loot awarded this tier (IMPORTRANGE source) |
| Pasted Loot | RCLC loot imported via the officer dashboard |
| Attendance | Per-night attendance statuses for scoring and penalty date tracking |
| Roster Responses | Season signup submissions |
| Self Received Requests | Raider-submitted received item requests |
| BiS Responses | BiS list link submissions |
| M+ Exclusion Requests | Raider-submitted M+ exclusion requests |
| Officer Audit Log | Append-only officer action log |

---

## Passwords and sessions

- **Officer password** -- set in `js/officer.js` as `var OFFICER_PASS = '...'`. Sessions last 2 hours; revisiting `officer.html` after expiry re-prompts.
- **Raider access** -- no login. The page URL shared via Discord is the only gate.
