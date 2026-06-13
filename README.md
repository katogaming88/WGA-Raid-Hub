# Phoenix Roster

A live web page for Team Phoenix that gives raiders a personal loot priority view and officers a full dashboard — all pulled directly from the Phoenix Loot Priority Google Sheet.

---

## What it does

### Raider view
Raiders open the page, select their character from the dropdown, and see their personal profile:

- **Attendance** — full-tier attendance percentage with a colour-coded progress bar, expandable to show any Excused/No Show dates
- **Items Received** — total items received this tier, expandable to show the full list
- **BiS List** — a link to their submitted BiS list (if provided)
- **Loot Priority** — every item on their BiS list with their current priority rank, slot, and source (raid item, M+, Crafted, or Catalyst)

### Officer dashboard
Officers log in with a separate password and get a tabbed dashboard:

- **Roster** — full player table with attendance, items received, BiS link status, and trial/bench tags. Filterable by Low Attendance (<90%), No BiS Link, Trials Only, or Bench Only. Click any player row to expand their full profile inline.
- **BiS Conflicts** — every raid item sorted by how many players want it. Shows each player's name and their current priority rank. Helps officers identify contested items quickly.
- **Loot Fairness** — every roster member shown as a bar chart sorted by items received this tier, coloured by role. Makes distribution fairness visible at a glance.
- **Attendance** — all players below 90% attendance, sorted lowest first, with their penalty dates listed.

---

## File structure

| File | Purpose |
|------|---------|
| `index.html` | The web page hosted on GitHub Pages (raider + officer views) |
| `PhoenixRosterWebApp.gs` | Google Apps Script that reads the spreadsheet and serves data as JSON |
| `syncClassSpecFromApplicants.gs` | Apps Script function that syncs Class/Spec from Roster Applicants into the Roster tab |
| `AttendanceFormula.txt` | The attendance % formula for Roster tab column C |

---

## How it works

1. The **Google Sheet** is the source of truth — officers update the Roster, BiS List, Priority Order, Scoring, and Loot Data tabs as normal
2. The **Google Apps Script** (`PhoenixRosterWebApp.gs`) reads those tabs and returns a JSON payload when the page requests it
3. The **GitHub index** (`index.html`) fetches that JSON on load and renders all views dynamically
4. The page is hosted on **GitHub Pages** and the URL is shared with raiders via Discord

Data is cached for 5 minutes on the Apps Script side for fast load times. Run **Clear Roster Page Cache** from the Phoenix Prio Loot menu to force a refresh after making sheet changes.

---

## Setup

### 1. Google Apps Script Web App (one time)

1. Open the Google Sheet → **Extensions → Apps Script**
2. Create a new file and paste in `PhoenixRosterWebApp.gs`
3. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web App URL (`https://script.google.com/macros/s/.../exec`)
5. Open `index.html`, find `var WEB_APP_URL = '...'` and paste the URL in
6. Set `var OFFICER_PASS = '...'` to your chosen officer password
7. Upload `index.html` to GitHub as `index.html`

### 2. GitHub Pages (one time)

1. Create a GitHub repo (e.g. `phoenix-roster`)
2. Upload `index.html` as the root file
3. Go to **Settings → Pages → Deploy from branch → main / root**
4. Your URL will be `https://yourusername.github.io/phoenix-roster`

### 3. Roster tab columns

The Roster tab must have this column layout for the Apps Script to read correctly:

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

### 4. Apps Script menu items

Add these to your menu in `Code.gs`:

```js
.addItem('Sync Class/Spec from Applicants', 'syncClassSpecFromApplicants')
.addItem('Clear Roster Page Cache', 'clearRosterCache')
```

---

## Officer workflows

| Task | What to do |
|------|-----------|
| Player joins | Add to Roster tab → Clear cache |
| BiS link submitted | Paste link into Roster col I → Clear cache |
| Priority updated | Run Priority Generator → Clear cache |
| Attendance refreshed | Run WCL Refresh → Commit Attendance → Clear cache |
| Class/Spec populated | Run Roster Applicants refresh → Run Sync Class/Spec → Clear cache |
| Loot awarded | RCLootCouncil exports to Loot Data tab automatically → Clear cache |

---

## Redeploying the Google Apps Script

Only needed when the Apps Script code itself changes — not for sheet data changes.

1. Apps Script → **Deploy → Manage Deployments**
2. Click the pencil icon on the existing deployment
3. Set version to **New version**
4. Click **Deploy** — the URL stays the same, no need to update `index.html`

---

## Sheet tabs read by the Apps Script

| Tab | What's read |
|-----|------------|
| Roster | Player list, roles, trial/bench status, BiS links, Class/Spec, Sort Key |
| Scoring | Attendance scores (column D, 1–10 scale) |
| BiS List | Each player's BiS items per slot |
| Priority Order | Ranked player lists per item |
| Item Lookup | Item names and slot types |
| Loot Data | All loot awarded this tier (column A = player) |
| Attendance | Per-night attendance statuses for penalty date tracking |

---

## Passwords

- **Officer password** — set in `index.html` as `var OFFICER_PASS = '...'`. Change it by editing the file and re-uploading to GitHub. Officers stay logged in for their browser session.
- There is no raider login — the dropdown acts as the selector. The page URL itself is the only gate for raiders.
