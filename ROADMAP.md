# Phoenix-Roster Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Phase 4: Stability & Officer Tooling

Performance fixes and officer dashboard completions that don't require new infrastructure.

- [ ] Priority order management from the web app -- dedicated UI to assign and reorder player priorities per item, with a priority generator that suggests an order based on BiS lists, role, and loot fairness data; writes back to the Priority Order sheet (#111)
- [ ] Season selector -- global filter on the officer dashboard to scope loot counts, fairness, conflicts, and attendance to a specific season; "All Seasons" option retains current behavior (#115)
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
- [ ] Record which officer committed each attendance change -- wire actor identity into the audit log once Discord OAuth ships (#112, depends on #25)

---

## Shipped

- [x] Add/remove players from the roster directly from the page (#3)
- [x] Change a player's role, trial status, or bench status from the page (#4)
- [x] BiS list URL submission from the raider profile -- officer approval queue, per-player access toggle, officer direct update (#5, #58)
- [x] Officer notes per player -- free-text, stored server-side, visible only in officer view (#6)
- [x] Full loot history per player (expandable detailed log) (#7)
- [x] Flag items as contested where multiple players have it in their BiS (#8)
- [x] Loot distribution fairness view -- who has received the most vs least (#10)
- [x] Full priority order for every item on one page without opening the sheet (#11)
- [x] Show which items have no players assigned a priority yet (#13)
- [x] Full attendance history per player in the officer profile panel -- expandable date-by-date log with all statuses, summary line, and status colour-coding (#14)
- [x] Filter roster by players below an attendance threshold (#15)
- [x] Flag players who have not submitted a BiS list yet (#17)
- [x] Show which items are most contested across the whole raid (#18)
- [x] Filter roster by who has a specific item in their BiS list (#19)
- [x] Filter roster table by role, trial status, bench status (#20)
- [x] Sort roster table by attendance, items received, or name (#21)
- [x] Search by player name (#22)
- [x] Officer write functionality -- update BiS links, nicknames, trial/bench status directly from the page back to the Google Sheet (#23, shipped across multiple PRs)
- [x] Per-raider BiS change request system -- raider submits an updated BiS link plus notes on what changed; officer approves before the sheet updates (#24, closed by PR #73)
- [x] Officer approve/reject writes approved applicant to Roster sheet (#56, closed by PR #73)
- [x] M+ exclusion request form -- raider submits Raider.io profile + notes; officer approval queue; approved players marked M+ excluded in sheet (#57, closed by PR #73)
- [x] Split single-page app into two pages (index + officer dashboard) with modular JS files per tab (#63)
- [x] Roster health summary -- pending action count badges on each officer tab (#76)
- [x] Join date tracking per player -- set automatically on add, editable in officer profile, visible on roster table (#77)
- [x] Trial promotion tracking -- officer roster tab surfaces trials who have been on the roster long enough with sufficient attendance to warrant a promotion review (#78)
- [x] Officer action audit log -- append-only log sheet capturing every officer mutation (player add/remove, field changes, BiS/signup/M+/loot-mark approvals, notes) with old->new values; dedicated Audit Log tab in the officer dashboard (#83)
- [x] Attendance entry from the officer dashboard -- Refresh from WCL, night-by-night status grid with editable dropdowns, per-player card editing, and Commit Scores to Scoring sheet; all changes logged to audit log (#94)
- [x] RCLootCouncil priority export string -- generated from the Priority tab and displayed with one-click copy in the officer dashboard (#98)
- [x] RCLootCouncil loot history import via officer dashboard -- paste RC JSON export, deduplicated by RCLC id, season label from Season Settings, merges with existing Loot Data sheet (#101)
- [x] Payload split into fast core chunk (roster, priority) and lazy heavy chunk (loot, attendance) so the page is usable before all data arrives (#104)
- [x] Season start date + exclude pre-join attendance from scoring (#107)
- [x] Season signup form -- multi-step flow accessible from the landing page
- [x] Officer open/close signup toggle -- state persists server-side
- [x] Submission confirmation screen
- [x] Apps Script GET-based write pattern -- no POST endpoint required
- [x] Self-mark items as received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) -- officer approval queue
- [x] Edit player class, spec, and name/realm from the officer dashboard without delete and re-add -- class/spec save on dropdown change, name/realm via Save button, officer notes migrated on rename (#118)
- [x] Contextual help tips on the officer dashboard -- collapsible ? buttons next to Attendance management, Season Settings, and Loot Import explaining each workflow; season reset steps listed in the Season tab (#120)
