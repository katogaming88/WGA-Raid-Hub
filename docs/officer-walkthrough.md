# Officer Dashboard Walkthrough

Reference notes for walking an officer through the dashboard -- not published to officers.

## Logging in

- Go to the officer page URL (not the public page)
- They log in with Discord -- session lasts 2 hours, then it re-prompts (the shared officer password was removed since access is fully Discord/RLS-gated now)
- Point out the season selector dropdown in the toolbar -- it filters most views to a specific season
- Top nav also has **Roster**, **Streams**, **Sign Up**, and **Help** links back to the public site (index.html) -- useful for checking how something looks from a raider's point of view without logging out

---

## Weekly / Recurring Workflow

The day-to-day job as an officer comes down to three cadences. These are the app's own
canonical steps (also built into the dashboard's Officer Guide tab) -- point people there
directly once they've seen it walked through once.

### After each raid night
1. **Loot tab -> Import** -- confirm Season Name is set in Season Settings, paste the
   RCLootCouncil JSON export, click Import. Duplicates are skipped automatically -- safe to
   paste multiple nights at once or re-paste an old export.
2. **Attendance tab -> Manage** -- Refresh from WCL (pulls the latest raid nights), review/edit
   any player statuses in the grid, then Commit Attendance Scores (recalculates attendance % for
   everyone -- safe to run multiple times, always recalculates from scratch).
3. **Scoring tab** -- Refresh from WCL (calculates ilvl-bracket scores for DPS), enter manual
   scores for tanks/healers, then Commit Performance Scores (saves the Recent score into the
   official Performance value Priority Generator uses).
4. **Priority tab** -- re-run Suggest Order for any item that just became contested.

### Ongoing -- review these as submissions come in
- **Signups** -- new applications
- **BiS Manager -> Submissions** -- link approvals/rejections
- **M+ Exclusions** -- exclusion requests
- **Received Item Requests** -- self-reported items from outside raid

### Once per season (the app's own "Rollover workflow")
1. Set an **End Date** on the current season if it closes before the next one starts.
2. **Season Settings -> History -> Archive Current Season** -- pushes Season Name/Start/End
   into history so it shows up in the season selector dropdown going forward.
3. Set the new **Season Name** and **Start Date** for the upcoming season.
4. **Loot -> Import History -> Clear All Loot History**, then re-import the new season's loot
   via **Loot -> Import** (entries auto-tag with the new season name).
5. **Attendance -> Refresh from WCL** to pull the new season's raid nights.
6. Also worth doing at reset: **M+ Exclusions -> Clear All Exclusions** -- clears who's
   currently excluded while keeping the request history intact (relabeled `Reset`, not
   deleted). **Do not** use Admin -> Danger Zone -> "Clear M+ Exclusion Requests" for this --
   that permanently deletes the request history instead and leaves everyone's active exclusion
   untouched, which is the opposite of what a season reset needs. See the M+ Exclusions
   section below for the full distinction.

---

## Roster tab

Two sub-tabs: **Roster**, **Discord Claims**.

- Search box, plus filter chips: Low Attendance (<95%), No BiS Link, Trials Only, Bench Only
- Role filter chips (Tank/Heal/Melee/Ranged) and sort (Name/Attendance/Items)
- **Buff Coverage** panel -- read-only, checks Raid Buffs/Boss Debuffs/Utility across the
  active (non-bench) roster and flags anything under-covered
- **Trial promotion banner** -- appears automatically once a trial meets both thresholds set
  in Season Settings (weeks on roster + attendance %)
- **+ Add Player** button in the table header
- Click any player to expand their profile card inline. From the card they can:
  - Change class, spec, role, trial/bench status, join date
  - Rename a player via the Name/Realm field (character or realm change) -- this also updates
    their name on the Attendance and Loot sheets
  - Add a private officer note (only visible on the dashboard)
  - Update a player's BiS link directly without waiting for a submission
  - Allow a player to submit a BiS update even when submissions are closed
  - Toggle their M+ exclusion directly, without a request
  - Mark an item as received directly (skips the approval queue)

**Discord Claims sub-tab** -- shows characters claimed by raiders via Discord login. Remove a
claim if a raider linked the wrong character. Officer *promotion* (making someone an officer)
happens in the Admin tab's Officers sub-tab, not here.

---

## Loot tab

Three sub-tabs:

- **Import** -- paste RCLootCouncil JSON from in-game; entries are tagged with the current
  Season Name automatically. Set Season Name in Season Settings first.
- **Import History** -- shows total entries imported and the most recent date. **Clear All Loot
  History** wipes pasted imports at a season reset -- it does not touch the legacy Loot Data
  sheet (the old IMPORTRANGE source), only entries pasted through this Import tab.
- **Loot Fairness** -- bar chart of items received per player; filter by Heroic or Mythic

---

## Priority tab

At the top: **RCLootCouncil Export String** -- Generate/Regenerate pulls an already-encoded
string built from the current priority order and roster. Copy it into RCLootCouncil in-game
to sync priorities to the council.

Three sub-tabs:

- **Priority List** (default) -- read-only full ranked order per item; filter by boss, search by
  name, or hide empty entries. Its badge counts stale-after-Heroic Mythic #1s, same-boss #1
  conflicts, and players holding 2+ #1s team-wide; a banner also flags incomplete raider
  Wishlists (see BiS Manager -> BiS Lists for who's missing what)
- **Contested Items** -- items wanted by multiple players; flags any player holding 1st priority
  on more than one item so over-allocation gets caught before loot decisions
- **Unmanaged Items** -- BiS items with no priority order set yet; badge shows the count

Clicking Edit (or Set Heroic/Set Mythic on an unmanaged item) opens the priority editor:
- Heroic/Mythic toggle at the top
- **Suggest Order** auto-ranks eligible players by blended score (role x attendance x WCL
  performance)
- Drag to reorder manually; add players from the pool on the right (defaults to BiS players
  for that item, toggle "Show all roster" to widen it); max 10 players per item
- A warning appears if someone ranked below a player who already has the Heroic version is
  themselves marked "No Version" -- worth a manual review before saving
- Save

---

## BiS Manager tab

Two sub-tabs:

- **Submissions** -- open/close toggle controls whether raiders see the BiS submit form.
  Approving updates the player's BiS link on the Roster automatically; Rejecting discards the
  submission with no change. A single player can be allowed to submit even while the window is
  closed, via the "Allow BiS Submit" toggle on their Roster profile card.
- **BiS Lists** -- every player grouped by role with their item count. A player with an
  incomplete raider Wishlist shows a "Wishlist incomplete (N)" badge next to their name, hover
  for which slots are missing. Click Edit to open an inline item editor -- search is filtered to
  their armor type automatically, their BiS source link is shown at the top, and Save writes the
  list back.

---

## Attendance tab

Three sub-tabs:

- **Manage** -- the main grid.
  - **Refresh from WCL** -- pulls the latest raid nights; run this after each raid night.
  - Click any player's status cell to set it manually: Present, Bench, Medical Leave, Excused,
    Extended Leave, No Show, or Not on Roster. Saves immediately (checkmark confirms).
  - **Exclude Report** toggle per raid night -- for alt runs or the wrong zone getting pulled
    in; excludes that whole night from scoring.
  - **Commit Attendance Scores** -- recalculates every player's attendance % and saves it to
    Scoring. Safe to run repeatedly; always recalculates from scratch.
- **Attendance Scores** -- threshold slider (default 95%); lists players at or below it with
  their specific penalty dates.
- **Bench Fairness** -- attendance view scoped to bench players specifically.

---

## Scoring tab

- **Refresh from WCL** -- calculates an ilvl-bracket percentile score for DPS from recent
  Warcraft Logs reports, holding draft Recent/Trend/Best values in a session cache. Tanks and
  healers don't get an automatic score -- click their cell to enter one manually.
- "use" next to the Trend score applies the widest-lookback Best score instead of Recent, if
  that reads more fairly for someone with a rough recent run.
- **Commit Performance Scores** -- saves the Recent score into the official Performance value
  that Priority Generator actually reads. Safe to run repeatedly.
- Color legend: green >=7.0 (Strong), gold >=5.0 (Average), dim <5.0 (Below average), purple
  (Trend fallback -- no recent data), red (No data), grey (Excluded -- Tank/Healer).

---

## Signups tab

Three sub-tabs: **Signups**, **Pending Roster**, **History**.

- **Signups** -- open/close toggle shows/hides the Sign Up button on the landing page.
  Approving marks the application approved and moves it to Pending Roster; Denying marks it
  rejected. If someone re-submits, it overwrites their existing pending entry rather than
  creating a duplicate. The "x" button deletes a submission outright.
- **Pending Roster** -- applications approved but not yet on the roster. Each card has its own
  **Add to Roster** button (with a trial toggle and, for main-swap signups, a swap picker); a
  selection checkbox per card plus **Select All** and **Add Selected to Roster** push a chosen
  subset at once. A **Buff Coverage** panel checks the pending group the same way the Roster
  tab's does. A collapsible **Missing Signups** panel lists roster members who haven't submitted
  a signup this cycle -- read-only, no bulk-remove action from here. **Remove** dismisses a
  single pending entry instead.
- **History** -- read-only, grouped by Approved/Pending/Denied, filterable by season.

---

## M+ Exclusions tab

- Open/close toggle controls the raider-facing request form -- raiders submit their Raider.io
  profile and a reason.
- The form gates Submit on two self-attested checks (6/6 Myth in every M+ obtainable slot; gem
  sockets filled 2 of 3 or better on Helm/Bracer/Belt) before a raider can even reach the
  Raider.io/reason fields. These are self-reported, not verified by the app -- still check the
  Raider.io link and read the reason field yourself, especially for known exceptions like a
  raid-only trinket stuck below Myth track with no M+ equivalent (raiders are prompted to
  mention this in their notes).
- Approving flags the player as M+ excluded on the roster view.
- Exclusion can also be toggled per player directly from their Roster profile card, without a
  request.
- **Clear All Exclusions** (on this tab) -- the correct season-reset action. Clears the active
  exclusion list (nobody stays excluded going into the new season) and relabels any `Approved`
  request as `Reset` -- it does **not** delete anything, the full request history stays intact.
  This is completely different from Admin -> Danger Zone -> "Clear M+ Exclusion Requests,"
  which does the opposite: it permanently deletes the request history and does **not** touch
  who's currently excluded -- anyone excluded stays excluded. Running the Danger Zone version
  at a season reset would leave stale exclusions in place while destroying the record of why
  they were granted. Always use this tab's button for season reset, never the Danger Zone one.

---

## Received Item Requests tab

- Raiders submit when they get an item outside of raid (M+, Great Vault, Crafted, Catalyst,
  Bonus Roll).
- Approve marks it received in their loot history, affecting fairness scores and priority
  standing. Reject dismisses it with no change.
- Items can also be marked directly from a player's Roster profile card -- that bypasses this
  queue entirely and takes effect immediately.

---

## Season Settings tab

Three sub-tabs: **Settings**, **Raid Progression**, **History**.

- **Season Name** -- label applied to every loot entry imported through RCLootCouncil while
  it's set; also what the toolbar's Season dropdown filters by. Set before importing each
  season's loot.
- **Signup Season** -- a *separate* label stamped on signup submissions, distinct from Season
  Name. If left blank, signups get no season tag and won't show up in season-filtered views.
  Set before opening signups.
- **Season Start Date** -- raids before this date are excluded from attendance scoring;
  players who joined after it use their own join date as the window start instead. Leave blank
  to include all raids.
- **Season End Date** -- optional upper bound, for when a season closes before the next one
  starts.
- **Trial Promotion Thresholds** -- weeks-on-roster *and* attendance % a trial needs to hit
  both of before the Roster tab's promotion banner appears for them.
- **Raid Progression** -- one block per raid in the season; boss kill dates show publicly on
  the landing page. Mini-raids (single/small standalone bosses) have no AOTC date. Archived
  along with the season.
- **Archive Current Season** -- pushes the current Season Name/Start/End into history so it
  appears in the season selector going forward; see the Rollover workflow above.
- **Season History** -- past archived seasons, with an **Unarchive** option to restore one as
  active if it was archived by mistake. The most recently archived season also has a
  **WCL Performance Baseline** fetch (#264) -- picks a raid tier from that season, pulls each
  DPS roster player's best character-page performance average (highest difficulty they logged,
  mythic if any, heroic otherwise) from WCL, and writes it to `player_wcl_season_perf`. Also
  seeds `scoring.performance_score` for the *new* season so heroic priority generation has a
  baseline number before any current-season raid reports exist -- never overwrites a real
  Commit Performance Scores result, only fills in players with no score yet. Run once, right
  after archiving the old season and starting the new one.

---

## Officer Bios tab

- Editor for the officer cards shown on the public **Bios** tab -- **+ Add Officer** can prefill
  name/character/class/spec from an existing roster player (a one-time copy, not a live link;
  editing or removing that player later never touches the bio), or start blank.
- Per card: display name, character name, title, pronouns, class/spec, an image path (commit a
  photo to `assets/officers/` in the repo first, then paste its relative path -- blank shows
  initials instead), and a short bio text. Reorder with the up/down arrows, **Remove** deletes a
  card, **Save Bios** writes the whole list back.

---

## Audit Log tab

- Every officer action is logged automatically -- approvals, edits, loot marks, status changes
- Shows timestamp, actor, action, target, old value, new value
- Search box to filter by officer, action, or player name

---

## Reports tab

Reads directly from Supabase report views -- no Apps Script fallback. Four sub-tabs:

- **Raid Nights Since Last Item** -- how many raid nights have passed since each active roster
  player's last loot award, grouped/filterable by role, sortable by player/last award/nights
  since.
- **BiS Demand vs Awards** -- ranks items by how many active players want them on their BiS list
  next to how many times each has actually been awarded in the selected season; high demand +
  low awards is what to prioritize.
- **Priority Order Health** -- three lists, filterable by season: **Stale Entries** (players
  ranked in a season's priority order who are no longer on the active roster), **Missing From
  Priority Order** (active non-bench players with no priority order entry at all that season),
  and **Mythic #1 Possibly Stale** (a saved Mythic #1 where the player already received the
  Heroic version of that same item -- not necessarily wrong, just worth a second look).
- **Season Loot Pace** -- items awarded per week of the season vs. the same week last season,
  filterable by track and slot. "Week 1" is measured from the season's first tracked loot award,
  not the raid-lockout calendar, since Supabase doesn't store a season start date yet.

---

## Officer Guide tab

- Renamed from "Help" (#354) to avoid confusion with the top nav's raider-facing Help link,
  which points back at the public site. The dashboard's own built-in "Officer Workflow
  Reference" -- numbered steps for importing loot, refreshing/editing/committing attendance,
  setting season dates, and the full season reset workflow. Point people here directly once
  they've seen the flow explained once, rather than re-explaining it from scratch every time.

---

## Admin tab (reference only -- not part of the normal weekly flow)

Restricted by role: site admins see the whole tab, team leaders see every sub-tab except Data
Export (plus only Clear Season History within the Danger Zone), and regular officers don't see
the tab at all. In practice this is usually one or two people per team. Five sub-tabs:

- **Properties** -- read-only live snapshot of this team's season settings: season name/dates,
  archived season count, raid progression count, whether Signups/BiS Submissions/M+ Exclusions
  are open. Has its own Refresh button. (Discord bot URLs/secrets are Supabase Edge Function
  secrets now, #224 -- edit them in the Supabase dashboard, not here.)
- **Data Export** -- downloads everything currently loaded in the dashboard (roster, loot
  history, priority order, BiS lists, season history, scoring) as JSON. No server call --
  exports straight from the in-memory cache, so it reflects whatever's currently loaded.
- **Officers** -- grant or revoke *officer* access for claimed characters (writes
  `team_members.role` in Supabase). Making someone a *team leader* or *site admin* is **not**
  done here -- team leader is a direct `team_members.role` change and site admin is a row in
  the `site_admins` table, both currently database-side only.
- **Feature Flags** -- per-team toggles to turn off features this team doesn't use (Loot Import
  & Tracking, Priority Order, BiS Lists, Scoring, M+ Exclusions, Fairness Charts, Bench
  Management, Attendance, Received Item Requests), effective immediately. Also has **Wishlist
  Tier Labels** here -- rename the 5 raider Wishlist status tiers for this team; blank keeps the
  default, colors don't change.
- **Danger Zone** -- permanent, irreversible wipes. Team leaders see only Clear Season
  History; the sheet wipes below it are site-admin only:
  - Clear Season History -- deletes all archived seasons
  - Clear Loot Data -- wipes imported RCLootCouncil loot entries
  - Clear Pasted Loot -- wipes the Pasted Loot sheet
  - Clear BiS Submissions -- wipes pending BiS link submissions
  - Clear Signups -- wipes all signup applications
  - Clear M+ Exclusion Requests -- permanently deletes every row of the M+ exclusion request
    history. Does **not** clear who's currently excluded -- that stays untouched. Not the same
    as, and not a substitute for, the M+ Exclusions tab's own "Clear All Exclusions" (the
    correct season-reset button -- see the M+ Exclusions section above)
  - Clear Pending Roster -- wipes approved applicants awaiting the roster-add step
  - Clear Self-Received -- wipes self-reported item requests
  - There's no undo -- double-check the season selector and what's about to be cleared before
    confirming
