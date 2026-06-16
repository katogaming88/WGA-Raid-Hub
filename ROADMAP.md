# Phoenix-Roster Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Loot Tracking

- [ ] See who is missing loot for each slot (e.g. who still needs a trinket) (#9)

## Priority Management

- [ ] Highlight conflicts where a player has been given top priority on multiple items by officers (#12)
- [ ] Show which items have no players assigned a priority yet (#13)

## Attendance

- [ ] Full attendance history per player expandable in the officer dashboard (#14)
- [ ] See who was benched most often vs absent (#16)

## Loot History

- [ ] Voluntary pass log -- officer marks that a raider passed on a piece; logged and factored positively into their loot priority standing (#37)

## Raider Profile (read-only, no login required)

- [ ] Visual BiS checklist on the character page -- each slot shown as received or still needed (#38)
- [ ] BiS completion percentage on each player's profile (#39)
- [ ] "Fully BiS" badge when a player has received every raid-source BiS item (#40)
- [ ] Last received item highlighted prominently on the profile ("Last received: X on date Y") (#41)
- [ ] Attendance trend on the character page -- recent-weeks indicator so raiders can self-monitor (#42)
- [ ] Public leaderboard -- sortable by attendance %, BiS completion %, items received (#43)

## Future / Larger Features

- [ ] Raider login via Discord OAuth -- Apps Script handles the OAuth callback and token exchange; no new infrastructure required. On first login, raider claims their character (one claim per character). Unlocks self-marking received items (crafted, catalyzed, M+) and personalized priority standing view. (#25)
- [ ] Personalized raider landing -- after Discord login and character claim, the app always opens directly on the raider's character card. Navigation links available from there to the main roster and other public views. Unauthenticated visitors see the existing generic flow unchanged. (#74)
- [ ] App role system -- a separate "App Role" column in the Roster sheet (admin-managed only) controls in-app permissions: blank = raider view, `officer` = officer dashboard + write access, `admin` = full control. Deliberately separate from guild officer status so non-team officers don't get write access. (#44)
- [ ] Officer claim management -- in-app UI listing all claimed characters with reassign/release controls, for handling player turnover or claim conflicts. (#45)
- [ ] Replace officer password with Discord login -- once the login system ships, remove the hardcoded password entirely. (#46)
- [ ] Priority standing on BiS items -- raiders see their rank for each contested raid item on their profile *(readable without login, but personalized view requires raider login)* (#47)

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
