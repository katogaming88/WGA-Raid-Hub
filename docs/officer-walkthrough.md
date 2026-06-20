# Officer Dashboard Walkthrough

## Logging in

- Go to the officer page URL (not the public page)
- Enter the officer password -- session lasts 2 hours, then it re-prompts
- The season selector dropdown in the toolbar filters most views to a specific season

---

## Roster tab

- Full player list -- filter by role, trial/bench, attendance, BiS status
- Click any player to expand their profile card inline
- From the card you can:
  - Change class, spec, role, trial/bench status, join date
  - Rename them (Name-Realm) if they transfer
  - Add a private officer note (only visible on the dashboard)
  - Update their BiS link directly without waiting for a submission
  - Allow them to submit a BiS update even when submissions are closed
  - Mark an item as received directly (skips the approval queue)
- Add Player / Remove Player buttons at the top

---

## Loot tab

Four sub-tabs:

- **Import** -- paste RCLootCouncil JSON from in-game; entries are tagged with the current season name automatically
- **Import History** -- shows what's already been imported, useful for checking if a night was already logged
- **Contested Items** -- every item on anyone's BiS list, sorted by how many people want it; shows each person's priority rank
- **Loot Fairness** -- bar chart of items received per player; filter by Heroic or Mythic

---

## Priority tab

- **RCLootCouncil Export** -- hit Generate, then Copy; paste that into RCLootCouncil in-game to sync priorities to the council
- **Priority List** -- full ranked order per item; filter by boss or search by name
  - Each item has a Priority Generator button -- auto-ranks eligible players by blended score (attendance x role x WCL)
  - You can drag/reorder the list before saving
- **Unmanaged Items** -- BiS items that don't have a priority order set yet; badge shows the count

---

## BiS Manager tab

Two sub-tabs:

- **Submissions** -- open or close BiS submissions for everyone; approve or reject individual submissions
  - Approving writes the link to the Roster sheet automatically
  - You can also open submissions for a single player from their Roster card without opening it globally
- **BiS Lists** -- shows every player grouped by role with their item count
  - Click Edit on any player to open an inline item editor
  - You can add/remove individual items; search is filtered to their armor type automatically
  - Their BiS source link is shown at the top of the editor
  - Hit Save -- writes back to the BiS List sheet

---

## Attendance tab

Three sub-tabs:

- **Manage** -- the main attendance grid
  - Refresh from WCL pulls the latest raid nights from Warcraft Logs
  - Click any cell in the grid to manually change a player's status for that night
  - Commit Scores to Sheet recalculates attendance % for everyone and writes it to the Scoring sheet -- safe to run multiple times
- **Attendance Scores** -- list of players below a threshold (slider to adjust); sorted lowest first with their penalty dates
- **Bench Fairness** -- attendance view for bench players specifically

---

## Signups tab

Two sub-tabs:

- **Signups** -- open or close the public signup form; review and approve/deny applications
  - Approving moves them to Pending Roster
- **Pending Roster** -- approved applicants; use Add to Roster to write them to the sheet, or Remove to dismiss

---

## M+ Exclusions tab

- Raiders can submit a request to be excluded from the M+ list
- Review, approve, or reject here
- You can also toggle exclusion per player manually without a request

---

## Received Item Requests tab

- Raiders submit when they get an item outside of raid (M+, vault, crafted, catalyst)
- Approve or reject here; approving adds it to their loot history and affects fairness/priority
- You can also mark items directly from a player's Roster card -- that bypasses this queue entirely

---

## Season Settings tab

- **Season Name** -- label applied to all loot you import (e.g. "Season 2"); set this before importing each season
- **Season Start Date** -- raids before this date are excluded from attendance scoring; players who joined after use their own join date
- **Season End Date** -- optional; set if the season closes before the next one starts
- **Raid Progression** -- add one block per raid; boss kill dates show publicly on the landing page
- **Archive Current Season** -- pushes current season into history, clears the settings; then set new name/start date for next season

---

## Audit Log tab

- Every officer action is logged automatically -- approvals, edits, loot marks, status changes
- Shows timestamp, action, target, old value, new value
- Search box to filter by player name or action type
- Actor column is blank until Discord OAuth ships

---

## Help tab

- Quick workflow reference built into the dashboard -- good to point people to if they forget a step
