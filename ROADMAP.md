# Phoenix-Roster Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Priority Management

- [ ] Highlight conflicts where a player has been given top priority on multiple items by officers (#12)
- [x] Show which items have no players assigned a priority yet (#13)

## Attendance

- [x] Full attendance history per player expandable in the officer dashboard (#14)
- [ ] See who was benched most often vs absent (#16)
- [ ] Attendance management from the officer dashboard -- trigger WCL refresh and fill in Bench/Excused/No Show statuses without opening the spreadsheet; commit scores to Scoring sheet from the UI. WCL fetch logic already exists as a standalone Apps Script. (#94)

## Loot History


## Officer Dashboard

- [x] Roster health summary -- pending action count badges on each officer tab (signups, pending roster, BiS requests, M+ exclusions, self-received) (#76)
- [x] Officer action audit log -- append-only log of every officer change (player added/removed, status changes, approvals, loot marks) stored in the Sheet (#83)
- [x] Priority export string accessible from the officer dashboard -- read the cached export string from the sheet and display it with a one-click copy, so officers never need to open the spreadsheet to grab the RCLootCouncil import string (#98)
- [ ] Officer quick-actions bar on the index page -- small bar visible only to authenticated officers (post Discord auth) with fast access to high-frequency tasks like grabbing the priority export string (#99, depends on #25)

## Roster / Player Management

- [x] Join date tracking per player -- set on add, visible on profile and roster table; foundation for trial promotion and season archive (#77)
- [x] Trial promotion tracking -- surface trials who have been on the roster long enough and have sufficient attendance to warrant review (#78, depends on #77)
- [ ] Season archive -- end-of-season roster snapshot triggered by officers; read-only archive view with previous seasons selectable (#79, depends on #77)

## Boss Progression

- [ ] Boss progression tracker on the landing page -- officers set farm/progression/not yet reached status per boss; first-kill dates for farm bosses (#80)

## Raider Profile (read-only, no login required)

- [x] Visual BiS checklist on the character page -- each slot shown as received or still needed; section renamed from "Loot Priority" to "BiS Checklist" (#38)
- [x] BiS completion percentage on each player's profile (#39)
- [x] "Fully BiS" badge when a player has received every raid-source BiS item (#40)
- [x] Last received item highlighted prominently on the profile ("Last received: X on date Y") (#41)
- [ ] Attendance trend on the character page -- recent-weeks indicator so raiders can self-monitor (#42)
- ~~Public leaderboard -- closed, drama risk outweighs the benefit (#43)~~

## Discord Bot

- [ ] `/pending-roster` command -- lists all pending signup applicants with their name, class, spec, and role; intended for use during season signup windows so officers can review who is queued (#86)

## Pre-Launch

- [ ] Move Discord bot from personal server to guild server -- set up officer notification channel so all officers can see app notifications (#84)

## Future / Larger Features

- [ ] Bench rotation fairness view -- bench rate per player (times benched vs. raids attended) to ensure fair rotation; similar to loot fairness view (#82)

- [ ] Raider login via Discord OAuth -- Apps Script handles the OAuth callback and token exchange; no new infrastructure required. On first login, raider claims their character (one claim per character). Unlocks self-marking received items (crafted, catalyzed, M+) and personalized priority standing view. (#25)
- [ ] Personalized raider landing -- after Discord login and character claim, the app always opens directly on the raider's character card. Navigation links available from there to the main roster and other public views. Unauthenticated visitors see the existing generic flow unchanged. (#74)
- [ ] App role system -- a separate "App Role" column in the Roster sheet (admin-managed only) controls in-app permissions: blank = raider view, `officer` = officer dashboard + write access, `admin` = full control. Deliberately separate from guild officer status so non-team officers don't get write access. (#44)
- [ ] Officer claim management -- in-app UI listing all claimed characters with reassign/release controls, for handling player turnover or claim conflicts. (#45)
- [ ] Replace officer password with Discord login -- once the login system ships, remove the hardcoded password entirely. (#46)

---

## Shipped

- [x] Full loot history per player (expandable detailed log) (#7)
- [x] Flag items as contested where multiple players have it in their BiS (#8)
- [x] Loot distribution fairness view -- who has received the most vs least (#10)
- [x] Full priority order for every item on one page without opening the sheet (#11)
- [x] Filter roster by players below an attendance threshold (#15)
- [x] Flag players who have not submitted a BiS list yet (#17)
- [x] Show which items are most contested across the whole raid (#18)
- [x] Filter roster by who has a specific item in their BiS list (#19)
- [x] Filter roster table by role, trial status, bench status (#20)
- [x] Sort roster table by attendance, items received, or name (#21)
- [x] Search by player name (#22)
- [x] Season signup form -- multi-step flow accessible from the landing page
- [x] Officer open/close signup toggle -- state persists server-side
- [x] Submission confirmation screen
- [x] Apps Script GET-based write pattern -- no POST endpoint required
- [x] Self-mark items as received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) -- officer approval queue
- [x] BiS list URL submission from the raider profile -- officer approval queue, per-player access toggle, officer direct update (#5, #58)
- [x] Add/remove players from the roster directly from the page (#3)
- [x] Change a player's role, trial status, or bench status from the page (#4)
- [x] Officer notes per player -- free-text, stored server-side, visible only in officer view (#6)
- [x] Officer approve/reject writes approved applicant to Roster sheet (#56, closed by PR #73)
- [x] M+ exclusion request form -- raider submits Raider.io profile + notes; officer approval queue; approved players marked M+ excluded in sheet (#57, closed by PR #73)
- [x] Officer write functionality -- update BiS links, nicknames, trial/bench status directly from the page back to the Google Sheet (#23, shipped across multiple PRs)
- [x] Per-raider BiS change request system -- raider submits an updated BiS link plus notes on what changed; officer approves before the sheet updates (#24, closed by PR #73)
- [x] Officer action audit log -- append-only log sheet capturing every officer mutation (player add/remove, field changes, BiS/signup/M+/loot-mark approvals, notes) with old->new values; dedicated Audit Log tab in the officer dashboard (#83)
- [x] Full attendance history per player in the officer profile panel -- expandable date-by-date log with all statuses, summary line, and status colour-coding (#14)
- [x] RCLootCouncil priority export string -- generated from the Priority tab and displayed with one-click copy in the officer dashboard (#98)
- [x] Join date tracking per player -- set automatically on add, editable in officer profile, visible on roster table (#77)
- [x] Trial promotion tracking -- officer roster tab surfaces trials who have been on the roster long enough with sufficient attendance to warrant a promotion review (#78)
