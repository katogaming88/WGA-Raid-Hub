# Phoenix Roster

A live raider-facing web page for Team Phoenix that displays attendance, loot priority, and BiS list information pulled directly from the Phoenix Loot Priority Google Sheet.

---

## What it does

Raiders open the page, select their character from the dropdown, and see:

- **Attendance** — full-tier attendance percentage with a colour-coded progress bar
- **Items Received** — total items received this tier, expandable to show the full list
- **BiS List** — a link to their submitted BiS list (if provided)
- **Loot Priority** — every item on their BiS list with their current priority rank, slot, and source (raid item, M+, Crafted, or Catalyst)

The landing page (before selecting a character) shows an attendance overview for the full roster, grouped by role (Tank → Healer → Melee → Ranged → Bench), sorted highest to lowest.

---

## File structure

| File | Purpose |
|------|---------|
| `index.html` | The raider-facing web page hosted on GitHub Pages |
| `PhoenixRosterWebApp.gs` | Apps Script Web App that reads the spreadsheet and serves data as JSON |
| `syncClassSpecFromApplicants.gs` | Apps Script function that syncs Class/Spec from Roster Applicants into the Roster tab |
| `AttendanceFormula.txt` | The attendance % formula for Roster tab column C |

---

## How it works

1. The **Google Sheet** is the source of truth — officers update the Roster, BiS List, Priority Order, Scoring, and Loot Data tabs as normal
2. The **Web App** (`PhoenixRosterWebApp.gs`) reads those tabs and returns a JSON payload when requested
3. The **HTML page** fetches that JSON on load and renders the raider's profile dynamically
4. The page is hosted on **GitHub Pages** and the URL is shared with raiders via Discord

Data is cached for 5 minutes on the Web App side for fast load times. Run **Clear Roster Page Cache** from the Phoenix Prio Loot menu to force a refresh after making sheet changes.

---

## Setup

### 1. Web App (one time)

1. Open the Google Sheet → **Extensions → Apps Script**
2. Create a new file and paste in `PhoenixRosterWebApp.gs`
3. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web App URL (`https://script.google.com/macros/s/.../exec`)
5. Open `index.html`, find `const WEB_APP_URL = '...'` and paste the URL in
6. Upload `index.html` to GitHub (renamed as `index.html`) and enable GitHub Pages

### 2. GitHub Pages (one time)

1. Create a GitHub repo (e.g. `phoenix-roster`)
2. Upload `index.html` as the root file
3. Go to **Settings → Pages → Deploy from branch → main / root**
4. Your URL will be `https://yourusername.github.io/phoenix-roster`

### 3. Roster tab columns

The Roster tab must have this column layout for the Web App to read correctly:

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

### 4. Sync scripts

Add these to your Apps Script menu in `Code.gs`:

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

## Redeploying the Web App

Only needed when the Apps Script code itself changes (not for sheet data changes).

1. Apps Script → **Deploy → Manage Deployments**
2. Click the pencil icon on the existing deployment
3. Set version to **New version**
4. Click **Deploy** — the URL stays the same

---

## Sheet tabs read by the Web App

| Tab | What's read |
|-----|------------|
| Roster | Player list, roles, trial status, bench status, BiS links, Class/Spec |
| Scoring | Attendance scores (column D, 1–10 scale) |
| BiS List | Each player's BiS items per slot |
| Priority Order | Ranked player lists per item |
| Item Lookup | Item names and slot types |
| Loot Data | All loot awarded this tier (column A = player) |
