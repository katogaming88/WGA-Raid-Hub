# Phoenix Roster

A live web app for Team Phoenix -- a full raid hub giving raiders a personal profile and officers a complete management dashboard, all driven by the Phoenix Loot Priority Google Sheet.

---

## What it does

### Landing page (public)

- Character selector dropdown -- choose your character to open your profile
- Stats row showing current Raiders count and total Items distributed this tier
- Recent Loot feed showing the last 10 items distributed across the roster

### Raider profile (public, no login)

- **Attendance** -- full-tier attendance percentage with a colour-coded progress bar, expandable to show any Excused/No Show dates
- **Items Received** -- total items received this tier, expandable to show the full list with slot and difficulty
- **BiS List** -- link to the player's submitted BiS list; submit or update directly from the profile
- **Loot Priority** -- every BiS item with the player's current priority rank, slot, and source
- **Self-mark received** -- submit items received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) for officer approval

### Season signup (public)

Multi-step signup form accessible from the landing page. Officers can open or close signups from the officer dashboard.

### Officer dashboard (`officer.html`)

Officers enter a password on page load (session lasts 2 hours). The dashboard has 11 tabs:

| Tab | What it shows |
|-----|--------------|
| **Roster** | Full player table with attendance, items, BiS status, trial/bench tags. Filter by role, attendance, BiS, or trial/bench. Sort by name, attendance, or items. Click a player to expand their full profile inline with edit controls. |
| **Contested Items** | Every raid item sorted by how many players want it, with each player's priority rank. |
| **Loot Fairness** | Bar chart of items received per player this tier, filterable by Heroic or Mythic. |
| **Attendance** | Players below the threshold (adjustable slider), sorted lowest first, with penalty dates. |
| **Priority** | Full priority order for every item, grouped by slot type, collapsible and searchable. |
| **Signups** | Open/close signup applications; view and delete signup responses. |
| **Pending Roster** | Review and approve or reject season signup applicants. |
| **Received Item Requests** | Approve or reject raider self-mark requests. Approving writes the item to Loot Data. |
| **BiS Submissions** | Open/close BiS submissions globally or per player; approve or reject submitted links. Approving writes the URL to the Roster sheet. |
| **M+ Exclusions** | Review and approve or reject M+ exclusion requests submitted by raiders. |
| **Audit Log** | Append-only log of every officer action -- player changes, approvals, loot marks, status changes -- with time, actor, action, target, and old/new values. Live search filter. |

Officer controls on the Roster tab:
- Add or remove players directly from the page
- Change role, trial status, or bench status per player
- Free-text officer notes per player (stored server-side, officer view only)
- Update a player's BiS link directly without the approval queue

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
| `js/tabs/tab-*.js` | One file per officer tab (8 files) |
| `css/styles.css` | All styles |
| `css/officer.css` | Stub for officer-specific styles (future split) |
| `gs/PhoenixRosterWebApp.gs` | Apps Script -- reads the sheet and serves data as JSON (web app endpoint) |
| `gs/Config.gs` | Shared constants -- sheet names, column indices, WCL credentials |
| `gs/Menu.gs` | Spreadsheet menu definitions (`onOpen`) |
| `gs/Export.gs` | RCLootCouncil priority export -- builds and base64-encodes the import string |
| `gs/Dropdowns.gs` | Priority Order and BiS List dropdown management |
| `gs/WCL.gs` | WarcraftLogs API -- fetches performance scores and writes draft/trend columns |
| `gs/Attendance.gs` | WCL attendance fetch, sheet writer, and score commit |
| `gs/PriorityGenerator.gs` | Blended priority score calculator for the Priority Generator tab |
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

Data is cached for 5 minutes on the Apps Script side. Use **Clear Cache** in the officer dashboard toolbar (or the Apps Script menu) to force a refresh after sheet changes.

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
| L | Display Name |

Paste the formula from `AttendanceFormula.txt` into **C4** and drag down. Format column C as custom number format `0"%"`.

---

## Officer workflows

| Task | What to do |
|------|-----------|
| Player joins | Use Add Player in the Roster tab, or add to the sheet then Clear Cache |
| Player leaves | Use Remove Player in the Roster tab |
| Role / trial / bench change | Edit inline in the officer Roster tab |
| BiS link submitted | Approve from the BiS Submissions tab (writes to sheet automatically) |
| Priority updated | Run Priority Generator in the sheet, then Clear Cache |
| Attendance refreshed | Run WCL Refresh > Commit Attendance in the sheet, then Clear Cache |
| Loot awarded | RCLootCouncil exports to Loot Data automatically; Clear Cache after |

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
| Roster | Player list, roles, trial/bench status, BiS links, Class/Spec, Sort Key |
| Scoring | Attendance scores (column D) |
| BiS List | Each player's BiS items per slot |
| Priority Order | Ranked player lists per item |
| Item Lookup | Item names and slot types |
| Loot Data | All loot awarded this tier |
| Attendance | Per-night attendance statuses for penalty date tracking |
| Roster Responses | Season signup submissions |
| Self Received Requests | Raider-submitted received item requests |
| BiS Responses | BiS list link submissions |

---

## Passwords and sessions

- **Officer password** -- set in `js/officer.js` as `var OFFICER_PASS = '...'`. Sessions last 2 hours; revisiting `officer.html` after expiry re-prompts.
- **Raider access** -- no login. The page URL shared via Discord is the only gate.
