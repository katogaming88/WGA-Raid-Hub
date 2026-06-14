# Phoenix-Roster Roadmap

Items marked `[x]` are shipped. Items marked `[ ]` are planned. Partially-built features are noted inline.

---

## Roster Management

- [ ] Add/remove players from the roster directly from the page
- [ ] Change a player's role, trial status, or bench status
- [ ] Update BiS links for players who submit them in Discord
- [ ] Add officer notes per player (visible only in officer view)

## Loot Tracking

- [ ] Full loot history per player (expandable detailed log — currently shows count only)
- [ ] Flag items as contested where multiple players have it in their BiS
- [ ] See who is missing loot for each slot (e.g. who still needs a trinket)
- [ ] Loot distribution fairness view — who has received the most vs least *(partially built)*

## Priority Management

- [ ] Full priority order for every item on one page without opening the sheet
- [ ] Highlight conflicts where a player is high priority on multiple items
- [ ] Show which items have no one ranked yet

## Attendance

- [ ] Full attendance history per player expandable in the officer dashboard
- [ ] Filter roster by players below an attendance threshold *(colour coding exists, filter not yet built)*
- [ ] See who was benched most often vs absent

## BiS Tracking

- [ ] Flag players who have not submitted a BiS list yet *(partially visible in officer roster table)*
- [ ] Show which items are most contested across the whole raid *(partially built in BiS Conflicts tab)*
- [ ] Filter roster by who has a specific item in their BiS list

## Filters and Sorting

- [ ] Filter roster table by role, trial status, bench status *(partially built)*
- [ ] Sort roster table by attendance, items received, or name
- [ ] Search by player name

## Future / Larger Features

- [ ] Officer write functionality -- update BiS links, nicknames, trial/bench status directly from the page back to the Google Sheet *(requires a POST endpoint on the Apps Script side)*
- [ ] Per-raider BiS change request system -- raider submits a change request, officer approves before it updates the sheet
- [ ] Raider login system tied to character name or nickname
