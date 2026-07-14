# WGA Raid Hub

A live web app for We Go Again raid teams -- a full raid hub giving raiders a personal profile and officers a complete management dashboard, all driven by a Google Sheet backend.

Supports multiple teams (Team Phoenix and Hellfire Rollers) from a single codebase. Append `?team=hellfire` to any URL to switch teams.

---

## What it does

### Landing page (public)

- Character selector dropdown -- choose your character to open your profile
- Stats row showing current Raiders count and total items distributed this tier
- Recent Loot feed showing the last 10 items distributed across the roster
- Raid Progression tracker showing all raids for the current season as cards with kill counts, boss lists, first-kill dates, and AOTC badge
- Discord login button -- sign in with Discord to claim your character and access personalised features

### Raider profile (public, no login)

- **Attendance** -- full-tier attendance percentage with a colour-coded progress bar and monthly sparkline, expandable to show any Excused/No Show dates
- **Items Received** -- total items received this tier, expandable to show the full list with slot and difficulty
- **BiS List** -- link to the player's submitted BiS list; submit or update directly from the profile
- **Loot Priority** -- every BiS item with the player's current priority rank, slot, and source
- **Self-mark received** -- submit items received outside of raid (M+, Great Vault, Crafted, Catalyst, Bonus Roll) for officer approval; Discord-authenticated raiders are auto-approved

### Discord login (raiders and officers)

Officers and raiders sign in with Discord through Supabase Auth (a full-page redirect). On first login, raiders claim their character from the roster; a "Claim your character" box on the home page also lets them claim any time they are logged in without one. Subsequent visits restore the session automatically.

- **My Profile** -- nav dropdown shortcut to your claimed character's profile page
- **Officers** -- Discord-authenticated officers go straight to the officer dashboard
- **Admins** -- a separate admin Discord ID list controls access to the Admin tab

### Season signup (public)

Multi-step signup form accessible from the landing page. Officers can open or close signups from the officer dashboard.

### Officer dashboard (`officer.html`)

Accessible via Discord OAuth only (session lasts 2 hours). The dashboard has a global season selector to filter loot, fairness, and attendance to a specific season.

| Tab | Sub-tabs | What it shows |
|-----|----------|--------------|
| **Roster** | Roster / Discord Claims | Roster: full player table with attendance, items, BiS status, trial/bench tags. Filter by role, attendance, BiS, or trial/bench. Sort by name, attendance, or items. Click a player to expand their full profile inline with edit controls. Discord Claims: all claimed Discord-to-character mappings; officers can remove claims; admins can grant or revoke officer access per user. |
| **Loot** | Import / Import History / Contested Items / Loot Fairness | Import: paste RCLootCouncil JSON to write loot to the sheet. Import History: view previously imported batches. Contested Items: every raid item sorted by how many players have it on their BiS, with each player's priority rank. Loot Fairness: bar chart of items received per player, filterable by Heroic or Mythic. |
| **Priority** | Priority List / Unmanaged Items | RCLootCouncil export string generator (generate and copy to clipboard). Priority List: full priority order per item, filterable by boss and searchable; each item has a Priority Generator button to auto-rank players by blended score with an editable, saveable order. Unmanaged Items: BiS items with no priority order yet assigned, with badge count. |
| **BiS Manager** | Submissions / BiS Lists | Submissions: open/close BiS submissions globally or per player; approve or reject submitted links (approving writes the URL to the Roster sheet). BiS Lists: role-grouped player table; Edit opens an inline item editor with the player's current BiS items, BiS source link, and armor-type-filtered item search/autocomplete. |
| **Attendance** | Manage / Attendance Scores / Bench Fairness | Manage: attendance grid editable per player per night; Refresh from WCL pulls latest raid nights; Commit Attendance Scores writes attendance % to Scoring. Attendance Scores: players below a threshold (adjustable slider), sorted lowest first. Bench Fairness: bench player attendance comparison. |
| **Signups** | Signups / Pending Roster | Signups: open/close the public signup form; review, approve, or deny signup submissions. Pending Roster: approved applicants waiting to be added to the roster. |
| **M+ Exclusions** | -- | Review and approve or reject M+ exclusion requests submitted by raiders. Toggle exclusion per player manually. |
| **Received Item Requests** | -- | Approve or reject raider self-mark requests. Approving writes the item to their loot history. Officers can also mark items received directly from the Roster tab player card. |
| **Season Settings** | -- | Season Start Date (attendance window start), Season Name (applied to imported loot), Season End Date (optional close date), Raid Progression (boss kill dates shown publicly), Archive Season (pushes season to history and resets settings), Season History (list of past seasons). |
| **Audit Log** | -- | Append-only log of every officer action -- player changes, approvals, loot marks, status changes -- with timestamp, actor, action, target, and old/new values. Live search filter. |
| **Admin** | Properties / Data Export / Officers / Danger Zone | Visible to site admins and team leaders. Team leaders see Properties, Officers, and Clear Season History in the Danger Zone; Data Export and the sheet wipes are site-admin only. Officers sub-tab: grant or revoke officer dashboard access for claimed characters. |
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
| `js/common.js` | Shared globals, `TEAMS`, `VERSION`, data helpers, `renderProfile` |
| `js/discord.js` | Discord login via Supabase Auth (full-page redirect), session mapping, nav rendering |
| `js/roster.js` | Public page boot, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, auth gate, session expiry, tab dispatch |
| `js/tabs/tab-*.js` | One file per officer tab (15 files) |
| `css/styles.css` | All styles |
| `css/officer.css` | Officer-specific styles |
| `gs/wgaWebApp.gs` | Apps Script -- reads the sheet and serves the roster/attendance/BiS/priority JSON payload (web app endpoint) and officer write actions (attendance refresh, loot import, priority export) |
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
2. The **Apps Script** (`wgaWebApp.gs`) reads those tabs and returns a JSON payload via JSONP when either page loads; Discord login and character claims now run through Supabase instead (Supabase Auth for login, the `claim_character` function for claims)
3. `index.html` and `officer.html` fetch that payload on load and render all views dynamically -- no page reloads. The roster itself now reads from **Supabase** (Phase 2 of the migration), with the Apps Script copy as fallback if that query fails; attendance and M+ exclusion fields still come from the Apps Script payload
4. Both pages are hosted on **GitHub Pages** at the repo root
5. The **TEAMS object** in `js/common.js` maps each team slug to its own GAS deployment URL; append `?team=hellfire` to switch teams

Data is split into two cached payloads: core (roster, settings -- 5 min cache) and heavy (BiS lists, item data, loot counts, attendance -- 15 min cache). Use **Clear Cache** in the officer dashboard toolbar to force a refresh after sheet changes.

---

## Setup

### 1. Google Apps Script (one time per team)

1. Open the Google Sheet -- **Extensions > Apps Script**
2. Create a script file for each `.gs` file in the `gs/` folder and paste in the contents
3. **Deploy > New Deployment** -- Type: Web App, Execute as: Me, Access: Anyone
4. Copy the Web App URL and paste it into the relevant `gasUrl` entry in `js/common.js` under `var TEAMS = { ... }`

### 2. Discord OAuth (one time)

1. Create a Discord app at [discord.com/developers](https://discord.com/developers/applications)
2. Under **OAuth2**, add redirect URI: `https://yourusername.github.io/repo-name/discord-callback.html`
3. Enable the `identify` scope
4. Copy the **Client ID** (public) and **Client Secret** (keep private)
5. In each team's Apps Script, go to **Project Settings > Script Properties** and add:
   - `DISCORD_CLIENT_ID` -- your Discord app client ID
   - `DISCORD_CLIENT_SECRET` -- your Discord app client secret
6. Replace `DISCORD_CLIENT_ID` in `js/discord.js` with your client ID
7. Replace `DISCORD_REDIRECT_URI` in `js/discord.js` with your actual callback URL

### 3. Officer and admin access

Officer and admin access is controlled by GAS Script Properties (set per team deployment):

| Property | Format | Effect |
|----------|--------|--------|
| `officerDiscordIds` | Comma-separated Discord user IDs | These users can access the officer dashboard via Discord login |
| `adminDiscordIds` | Comma-separated Discord user IDs | These users also see the Admin tab |

Discord user IDs can be found by enabling Developer Mode in Discord and right-clicking a user.

### 4. GitHub Pages (one time)

1. Push all files to your GitHub repo
2. **Settings > Pages > Deploy from branch > main / root**
3. Your public URL will be `https://yourusername.github.io/repo-name`

### 5. Roster tab columns

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

### 6. Item Lookup tab columns

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
| Grant officer access | Roster > Discord Claims > Grant Officer (admin only), or Admin > Officers |
| Revoke officer access | Roster > Discord Claims > Revoke (admin only), or Admin > Officers |
| Remove a Discord claim | Roster > Discord Claims > Remove |
| BiS link submitted | Approve from BiS Manager > Submissions (writes to sheet automatically) |
| Edit a player's BiS items directly | BiS Manager > BiS Lists > Edit |
| Loot imported | Loot > Import -- paste RCLootCouncil JSON; entries are tagged with the current season name |
| Priority updated | Priority tab > Priority Generator button per item; edit and Save |
| RCLootCouncil sync | Priority tab > Generate export string; copy and paste in-game |
| Attendance refreshed | Attendance > Manage > Refresh from WCL, then Commit Attendance Scores |
| New tier starts | Repopulate Item Lookup sheet -- see issue #132 |
| Season rollover | Season Settings -- see Archive Season rollover workflow and issue #131 |

---

## Redeploying the Apps Script

Only needed when `wgaWebApp.gs` or any `.gs` file changes -- not for sheet data changes.

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
| Discord Claims | Discord ID to Name-Realm mappings from OAuth login |
| Roster Responses | Season signup submissions |
| Self Received Requests | Raider-submitted received item requests |
| BiS Responses | BiS list link submissions |
| M+ Exclusion Requests | Raider-submitted M+ exclusion requests |
| Officer Audit Log | Append-only officer action log |

---

## Auth and sessions

- **Discord OAuth** -- only auth method for both raiders and officers. Sessions are stored in `localStorage` per team and validated against GAS on each page load. Sessions expire after 30 days.
- **Officer access** -- controlled by `officerDiscordIds` GAS Script Property (comma-separated Discord IDs). Takes effect immediately without requiring users to re-login.
- **Admin access** -- controlled by `adminDiscordIds` GAS Script Property. Admins see the Admin tab.
