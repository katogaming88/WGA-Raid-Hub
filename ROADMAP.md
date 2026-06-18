# Phoenix-Roster Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Phase 4: Stability & Officer Tooling

Performance fixes and officer dashboard completions that don't require new infrastructure.

- [ ] Fix payload load timeouts -- split into fast core chunk (roster, priority) and lazy heavy chunk (loot, attendance) so the page is usable before all data arrives (#104)
- [ ] Paste RCLootCouncil loot history directly in the web app -- officers paste the RC export once per season; app parses and stores it, replacing the manual sheet workflow (#101)
- [ ] Attendance entry from the officer dashboard -- trigger WCL refresh and fill in Bench/Excused/No Show statuses without opening the spreadsheet; commit scores to Scoring sheet from the UI (#94)
- [ ] Move Discord bot from personal server to guild server -- set up officer notification channel so all officers can see app notifications (#84)
- [ ] `/pending-roster` bot command -- lists all pending signup applicants with their name, class, spec, and role (#86)
- [ ] Highlight conflicts where a player has been given top priority on multiple items by officers (#12)
- [ ] See who was benched most often vs absent (#16)
- [ ] Bench rotation fairness view -- bench rate per player (times benched vs. raids attended) to ensure fair rotation; similar to loot fairness view (#82)
- [ ] Season archive -- end-of-season roster snapshot triggered by officers; read-only archive view with previous seasons selectable (#79)

---

## Phase 5: Raider & Public Views

Public-facing and raider-visible features that don't require login.

- [ ] Boss progression tracker on the landing page -- officers set farm/progression/not yet reached status per boss; first-kill dates for farm bosses (#80)
- [ ] Attendance trend on the character page -- recent-weeks indicator so raiders can self-monitor (#42)

---

## Phase 6: Discord Auth & Post-Auth Features

Everything gated on Discord OAuth shipping (#25).

- [ ] Raider login via Discord OAuth -- Apps Script handles the OAuth callback and token exchange; no new infrastructure required. On first login, raider claims their character. Unlocks self-marking received items and personalized priority standing view. (#25)
- [ ] Officer quick-actions bar on the index page -- small bar visible only to authenticated officers with fast access to high-frequency tasks (#99, depends on #25)
- [ ] Personalized raider landing -- after Discord login and character claim, the app always opens directly on the raider's character card (#74, depends on #25)
- [ ] App role system -- a separate "App Role" column in the Roster sheet controls in-app permissions: blank = raider view, `officer` = officer dashboard + write access, `admin` = full control (#44, depends on #25)
- [ ] Officer claim management -- in-app UI listing all claimed characters with reassign/release controls (#45, depends on #25)
- [ ] Replace officer password with Discord login -- once the login system ships, remove the hardcoded password entirely (#46, depends on #25)

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
- [x] Show which items have no players assigned a priority yet (#13)
- [x] Officer action audit log -- append-only log sheet capturing every officer mutation (player add/remove, field changes, BiS/signup/M+/loot-mark approvals, notes) with old->new values; dedicated Audit Log tab in the officer dashboard (#83)
- [x] Roster health summary -- pending action count badges on each officer tab (#76)
- [x] Full attendance history per player in the officer profile panel -- expandable date-by-date log with all statuses, summary line, and status colour-coding (#14)
- [x] RCLootCouncil priority export string -- generated from the Priority tab and displayed with one-click copy in the officer dashboard (#98)
- [x] Join date tracking per player -- set automatically on add, editable in officer profile, visible on roster table (#77)
- [x] Trial promotion tracking -- officer roster tab surfaces trials who have been on the roster long enough with sufficient attendance to warrant a promotion review (#78)
