# Phoenix-Roster Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Season Signup

- [ ] Public signup form -- members submit character name, class/spec, role, and BiS link for the upcoming season
- [ ] Officer review queue -- submitted signups appear in the officer dashboard for approve/reject before landing on the roster sheet
- [ ] Confirmation flow -- applicant sees a "submitted" state and gets notified (or instructed to watch Discord) after submitting
- [ ] Requires the Apps Script POST endpoint (see Officer write functionality below) to write approved signups back to the sheet

## Roster Management

- [ ] Add/remove players from the roster directly from the page
- [ ] Change a player's role, trial status, or bench status
- [ ] Update BiS links for players who submit them in Discord
- [ ] Add officer notes per player (visible only in officer view)

## Loot Tracking

- [ ] See who is missing loot for each slot (e.g. who still needs a trinket)

## Priority Management

- [ ] Highlight conflicts where a player is high priority on multiple items
- [ ] Show which items have no one ranked yet

## Attendance

- [ ] Full attendance history per player expandable in the officer dashboard
- [ ] See who was benched most often vs absent

## Loot History

- [ ] Voluntary pass log -- officer marks that a raider passed on a piece; logged and factored positively into their loot priority standing

## Raider Profile (read-only, no login required)

- [ ] Visual BiS checklist on the character page -- each slot shown as received or still needed
- [ ] BiS completion percentage on each player's profile
- [ ] "Fully BiS" badge when a player has received every raid-source BiS item
- [ ] Last received item highlighted prominently on the profile ("Last received: X on date Y")
- [ ] Attendance trend on the character page -- recent-weeks indicator so raiders can self-monitor
- [ ] Public leaderboard -- sortable by attendance %, BiS completion %, items received

## Future / Larger Features

- [ ] Officer write functionality -- update BiS links, nicknames, trial/bench status directly from the page back to the Google Sheet *(requires a POST endpoint on the Apps Script side)*
- [ ] Per-raider BiS change request system -- raider submits an updated BiS link plus a diff of which items changed; officer approves before the sheet updates
- [ ] Raider login via Discord OAuth -- Apps Script handles the OAuth callback and token exchange; no new infrastructure required. On first login, raider claims their character (one claim per character). Unlocks self-marking received items (crafted, catalyzed, M+) and personalized priority standing view.
- [ ] App role system -- a separate "App Role" column in the Roster sheet (admin-managed only) controls in-app permissions: blank = raider view, `officer` = officer dashboard + write access, `admin` = full control. Deliberately separate from guild officer status so non-team officers don't get write access.
- [ ] Officer claim management -- in-app UI listing all claimed characters with reassign/release controls, for handling player turnover or claim conflicts.
- [ ] Replace officer password with Discord login -- once the login system ships, remove the hardcoded password entirely.
- [ ] Priority standing on BiS items -- raiders see their rank for each contested raid item on their profile *(readable without login, but personalized view requires raider login)*

---

## Shipped

- [x] Full loot history per player (expandable detailed log)
- [x] Flag items as contested where multiple players have it in their BiS
- [x] Loot distribution fairness view -- who has received the most vs least
- [x] Full priority order for every item on one page without opening the sheet
- [x] Filter roster by players below an attendance threshold
- [x] Flag players who have not submitted a BiS list yet
- [x] Show which items are most contested across the whole raid
- [x] Filter roster by who has a specific item in their BiS list
- [x] Filter roster table by role, trial status, bench status
- [x] Sort roster table by attendance, items received, or name
- [x] Search by player name
