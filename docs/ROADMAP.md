# WGA Raid Hub Roadmap

Items marked `[ ]` are planned. See [Shipped](#shipped) at the bottom for completed features.

---

## Stress Test

End-to-end smoke tests to be run before launch or after a major rollout. These validate real-data paths that can't be exercised in dev.

- [ ] Season rollover end-to-end -- archive season, verify roster snapshot, new season settings, progression resets (#127)
- [ ] Raid progression archives correctly with season rollover (#131)
- [ ] Repopulate Item Lookup sheet for new season -- follow issue #132 guide and verify autocomplete, slot data, and boss filters load correctly (#134)
- [ ] Champion (Normal) loot tier priority scoring -- verify correct tier weighting once real Normal loot exists (#148)
- [ ] Verify unarchive season on a test sheet -- confirm data is restored cleanly without corrupting active season (#155)

---

## Phase 4: Stability & Officer Tooling

Performance fixes and officer dashboard completions.

- [x] Priority order management from the web app (#111)
- [x] Season selector -- global filter on the officer dashboard to scope loot counts, fairness, conflicts, and attendance to a specific season (#115)
- [x] Highlight conflicts where a player has been given top priority on multiple items by officers (#12)
- [x] Bench rotation fairness view (#82)
- [x] See who was benched most often vs absent (#16)
- [x] Season archive -- end-of-season roster snapshot triggered by officers; read-only archive view with previous seasons selectable; unarchive supported (#79, #143)
- [x] Move Discord bot from personal server to guild server -- set up officer notification channel so all officers can see app notifications (#84)
- [x] Discord bot slash commands -- `/pending-roster`, `/trials`, `/bench`, `/attendance`, `/absences`, `/mplus-excluded`, `/fairness`, `/officers` (#86)
- [x] Hide team switcher from non-admin officers (#157)
- [ ] In-app notification bell -- notify raiders when a submission (BiS, self-mark, M+) is approved or rejected without them having to log back in (#151)

---

## Phase 5: Raider & Public Views

Public-facing and raider-visible features.

- [x] Boss progression tracker on the landing page -- officers set farm/progression/not yet reached status per boss; first-kill dates for farm bosses (#80)
- [x] Attendance trend on the character page (#42)

---

## Phase 6: Discord Auth & Post-Auth Features

- [x] Raider login via Discord OAuth -- GAS handles the OAuth callback and token exchange; on first login raider claims their character; unlocks self-mark auto-approval and personalized profile shortcut (#25, #159, #160, #161, #162)
- [x] Self-mark received auto-approve for Discord-authenticated raiders (#164)
- [x] Profile shortcut -- "My Profile" nav dropdown item navigates to claimed character profile; replaces auto-redirect (#173, supersedes #74)
- [x] App role system -- explicit `officerDiscordIds` and `adminDiscordIds` GAS Script Properties control officer and admin access; recomputed live on every session validation (#44)
- [x] Officer claim management -- Discord Claims subtab in Roster; admins can grant/revoke officer access per claimed user; Admin > Officers subtab for full officer management (#45)
- [x] Replace officer password -- not implementing; password kept as fallback for localhost and non-Discord officers (#46, closed as won't-do)
- [x] Record which officer committed each attendance change -- wire Discord identity into the audit log (#112)
- [x] Officer quick-actions bar on the index page -- small bar visible only to authenticated officers with fast access to high-frequency tasks (#99)

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
- [x] Full attendance history per player in the officer profile panel (#14)
- [x] Filter roster by players below an attendance threshold (#15)
- [x] Flag players who have not submitted a BiS list yet (#17)
- [x] Show which items are most contested across the whole raid (#18)
- [x] Filter roster by who has a specific item in their BiS list (#19)
- [x] Filter roster table by role, trial status, bench status (#20)
- [x] Sort roster table by attendance, items received, or name (#21)
- [x] Search by player name (#22)
- [x] Officer write functionality -- update BiS links, nicknames, trial/bench status directly from the page back to the Google Sheet (#23)
- [x] Per-raider BiS change request system (#24)
- [x] Officer approve/reject writes approved applicant to Roster sheet (#56)
- [x] M+ exclusion request form -- raider submits Raider.io profile; officer approval queue (#57)
- [x] Split single-page app into two pages (index + officer dashboard) with modular JS files per tab (#63)
- [x] Roster health summary -- pending action count badges on each officer tab (#76)
- [x] Join date tracking per player (#77)
- [x] Trial promotion tracking -- surfaces trials ready for promotion review; promote button; configurable thresholds (#78, #145)
- [x] Officer action audit log (#83)
- [x] Attendance entry from the officer dashboard -- Refresh from WCL, editable status grid, Commit Scores to sheet (#94)
- [x] RCLootCouncil priority export string (#98)
- [x] RCLootCouncil loot history import via officer dashboard (#101)
- [x] Payload split into fast core + lazy heavy chunks (#104)
- [x] Season start date + exclude pre-join attendance from scoring (#107)
- [x] Season signup form -- multi-step flow, open/close toggle, officer approve/reject (#56)
- [x] Self-mark items as received outside of raid -- officer approval queue (#57)
- [x] Edit player class, spec, and name/realm from the officer dashboard (#118)
- [x] Contextual help tips and Help tab (#120)
- [x] BiS list management from the officer dashboard -- inline item editor with armor-type-filtered autocomplete; per-player BiS list editing (#128)
- [x] Champion (Normal) loot tier support in priority generator (#142)
- [x] M+ exclusion: show currently excluded players list; surface rejection reason on raider card (#144, #149)
- [x] Derive healer/tank role lists from Roster sheet instead of hardcoded Config.gs (#138)
- [x] Multi-team support -- Team Phoenix and Hellfire Rollers from a single codebase; team switcher in nav; `?team=` URL param (#136)
- [x] Priority order management from the web app -- priority generator with blended scoring (#111)
- [x] Season selector -- filter all officer views by season (#115)
- [x] Highlight conflicts where a player holds top priority on multiple items (#12)
- [x] Bench rotation fairness view (#82)
- [x] See who was benched most often vs absent (#16)
- [x] Season archive + view + unarchive (#79, #143)
- [x] Boss progression tracker on the landing page (#80)
- [x] Discord OAuth -- raider + officer login; character claiming; session management; admin-only Admin tab; officer management via Discord IDs (#25, #44, #45, #159-#164)
- [x] Profile shortcut -- "My Profile" in Discord nav dropdown; works from both index and officer pages (#173)
- [x] Discord Claims management -- Roster subtab; grant/revoke officer access per claimed user (#171, #172)
