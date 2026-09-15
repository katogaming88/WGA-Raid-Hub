# Revamp time log

A rough record of how long the website revamp (#1109) takes, kept as the work happens. The point is a real answer to "how long did the rebuild take?" and a way to check the remaining phases against their due dates.

**How times are measured.** Wall-clock time in Eastern, taken from the session transcript and GitHub timestamps. It starts when Kat asks for a piece of work and ends when that piece is merged, closed or decided. Rounded to 5 minutes. Breaks between sessions are not counted. "Build" is Claude working (reading, coding, testing, opening the PR). "Kat" is the time Kat spent deciding, doing dashboard/setup steps, reviewing, and merging. When the two overlap in a back-and-forth, the whole stretch is counted once under the item.

Work that happened in the same sessions but isn't part of the revamp (bug fixes, lookups) is listed separately at the bottom and not counted in the totals.

## Totals

| Phase | Time so far |
| --- | ---: |
| Planning and design | 1 h 50 m |
| Revamp 1: decisions and foundation | 6 h 55 m |
| Revamp 2: public pages | 5 h 50 m |
| **All revamp work** | **14 h 35 m** |

## Log

### 2026-09-13

| Time (ET) | Item | Phase | Elapsed | Build / Kat | Notes |
| --- | --- | --- | ---: | --- | --- |
| 2:01–2:16 PM | Rethink the site from scratch, size it for January, write the plan as issues | Planning | 15 m | mostly build | #1109 and its issues filed, framework + one app first |
| 2:16–3:27 PM | Visual design direction | Planning | 70 m | shared | First concept cards didn't land ("hard to picture"); switched to rendered mockups. Blue + ember chosen, light-mode badges, PRODUCT.md committed |
| 3:44–4:08 PM | Priorities and phases | Planning | 25 m | shared | Milestones Revamp 1–4; Identity and Discord notifications keep running alongside |
| 4:08–4:21 PM | #1100 page addresses | Revamp 1 | 15 m | Kat decision | `/g/<guild>/t/<team>`, readable keys for WGA, codes for others and for players |
| 4:21–4:40 PM | #940 per-account preferences | Revamp 1 (Identity prerequisite) | 20 m | ~12 m build, ~7 m review | PR #1111 |
| 4:42–4:45 PM | #1104 feature freeze | Revamp 1 | 5 m | Kat decision | Option C: two-step freeze |
| 4:50–5:49 PM | #1099 hosting on Cloudflare Pages | Revamp 1 | 60 m | shared, heavy on Kat | Domain bought, API token and secrets, custom domains, Supabase redirect URLs, www forwarding. PR #1112 (deploy job) and PR #1116 (My Profile fix under clean URLs) |
| 5:57–6:11 PM | #1114 guild record, URL keys, player codes | Revamp 1 | 15 m | ~11 m build, ~3 m review | PR #1119 |
| 6:17–6:43 PM | #941 person lookup, kept character links, name matching | Revamp 1 (Identity prerequisite) | 25 m | ~22 m build incl. one Kat question, ~4 m review | PR #1121. Tested on prod backup |
| 9:42–10:06 PM | #1106 access rules once per query | Revamp 1 | 25 m | ~18 m build incl. benchmark and one Kat question, ~6 m review | PR #1144. Benchmark changed the plan: rule rewrite instead of login-token hook |
| 10:10–10:30 PM | #1107 one file per database function | Revamp 1 | 20 m | ~10 m spike of Supabase's declarative schema, one Kat decision, ~8 m build; review time not yet counted | Spike found the declarative tool unsafe here (dropped a constraint, would have paused prod cron jobs); built a generated per-function mirror instead |
| 10:32–10:56 PM | #1101 part 1: app scaffold and look | Revamp 1 | 25 m | ~15 m build, ~10 m Kat testing locally, a light-mode nav fix, and a changelog merge conflict | Colors, frame, drawer, routes, contrast test, App CI workflow. Contrast check moved a few mockup colors (Death Knight the most) |
| 10:58–11:24 PM | #1101 part 2: addresses and data layer | Revamp 1 | 25 m | ~10 m build, ~15 m Kat review and merge | resolve_address lookups with redirects, team switcher, TanStack Query data layer with visible errors, first real read; checked against the local database |

### 2026-09-14

| Time (ET) | Item | Phase | Elapsed | Build / Kat | Notes |
| --- | --- | --- | ---: | --- | --- |
| 8:33–8:50 AM | #1101 part 3: Discord sign-in, roles, dialog | Revamp 1 | 15 m | build | Paused when Kat switched sign-in to Battle.net. The dialog and roles helper carry over; the Discord sign-in code gets reworked |
| 8:50–9:47 AM | Battle.net sign-in: decision and local test | Revamp 1 (Identity) | 55 m | shared, heavy on Kat | Battle.net client, provider setup (two false starts: the `custom:` prefix, and Blizzard's key format breaking oidc), Discord secret, two stack restarts, four sign-in tests. Decision logged, #942 and #1101 re-planned, #1157 filed |
| 9:49–10:22 AM | #1157 Connect Battle.net on the current site | Revamp 1 (Identity) | 35 m | ~15 m build, ~20 m Kat local test, hosted setup and merge | PR #1158. Menu button, officer claims column, `team_battlenet_connections()`, local setup script. The local test needed a claim made by hand, since the seed has none |
| 10:23–10:45 AM | #1101 part 3a: Battle.net sign-in in the new app | Revamp 1 | 20 m | ~12 m build, ~10 m Kat testing locally; review not yet counted | Sign-in, Connect Discord and Battle.net, "Use your Discord account" switch with `discard-empty-account`, roles once, officer gating, dialog and status components. Testing found a sidebar misalignment and a stale error riding the switch's return address, both fixed. Characters from Blizzard split to 3b |
| 10:45–10:52 AM | #1101 part 3a: CI fix and merge | Revamp 1 | 5 m | ~4 m build, ~3 m Kat merge | Edge Functions type check failed on a tagged union under non-strict Deno; fixed and checked locally with `npx deno` |
| 10:53–11:25 AM | #1101 part 4: preview deploy and app browser tests, then closing #1101 | Revamp 1 | 30 m | ~12 m build, ~18 m Kat merge, Cloudflare Access and Supabase setup, and the first sign-in on the preview | PR #1160. The browser tests found a real focus bug in the narrow-screen menu. One false start: sign-in landed on the old site until the preview was added to Supabase's redirect list. #1101 closed; Sentry split to #1161, characters from Battle.net to #1162. Runbook in `docs/app-preview.md` |
| 11:26–11:32 AM | Preview tester runbook | Revamp 1 | 5 m | ~4 m build, ~2 m Kat | `docs/app-preview.md` (v3.114.2). Kat decided doc changes in this repo go through PRs from now on |
| 11:33–11:47 AM | #1108 `tier_token_map` gets a season | Revamp 1 (Season) | 15 m | ~11 m build, ~3 m Kat review and merge | PR #1163. Re-audit found the tier-piece counter would check gear against the wrong tier once two tiers are seeded, and Sync Roster Tier Counts would write 0 for everyone with no seed. Went ahead of #931 (format already settled by #932) |
| 11:48 AM–12:28 PM | Decide #1070 and #1076 (Heroic sale runs) | Revamp 2 | 40 m | ~8 m build (reading six issues, framing options), ~30 m Kat deciding | Guests are signups on a run; per-run signup; guild price list copied onto each sale; type on each buyer; calendar shows types not prices; sales team officers manage. Still open: which team (setup), parse-bar strictness (moved to #1074) |
| 1:02–1:09 PM | Decide #1032 and #1033 (wishlist is BiS or Pass) | Revamp 2 | 5 m | ~4 m build (prod wishlist and award counts, framing options), ~3 m Kat deciding and merge | BiS or Pass only, at cutover; old 2nd Choice/Sidegrade/Catalyst rows deleted then; one pick per slot, two for paired slots. Kat chose it over a single "Upgrade" choice after seeing 97 of 256 awards went to non-BiS marks |
| 1:11–1:27 PM | Decide #868 (Mark Received, M+ in the wishlist) | Revamp 2 | 15 m | ~8 m build (prod receipts and rejected "Other" notes, catalog check), ~7 m Kat deciding | Mark Received is for outside guild raids, with Weekly quest and Pug raid added as instant sources and Other kept for officer review (Kat's point: Torbjorn's weekly-quest legs). Real M+ and crafted items in the catalog, filed as #1166 |
| 1:28–1:50 PM | #1102 Roster page, part 1 (#870) | Revamp 2 | 20 m | build; Kat review not yet counted | First page built the #1102 way: the current Roster tab's behavior recorded as browser tests, then the same checks run against the new page. Layout from the approved mockup, checked with Phoenix's real roster. Browser tests caught screen-reader text widening the page on phones |
| 1:53–2:05 PM | Roster page review fix | Revamp 2 | 10 m | ~5 m build, ~5 m Kat review on the preview | Kat spotted the summary panels lining up with the filter rather than the table; filter moved above both columns, with a browser test for the alignment |
| 2:07–2:25 PM | #868 player profile, part 1 | Revamp 2 | 20 m | ~18 m build, ~1 m Kat deciding who can open a profile | Kat kept today's rule: the raider and officers. Recording needed signed-in states on the current site for the first time. Found that raiders can't read their own refused M+ requests (officers only), recorded as-is |
| 3:06–3:20 PM | #868 player profile, part 2: loot priority | Revamp 2 | 15 m | build | BiS picks with "#2 of 5" standings on both tracks, received status, wishlist summary. Checking with a real raider's data caught the wishlist summary skipping picks saved before rows named their slot (7 of 16 instead of 16) |
| 3:24–3:40 PM | Profile tabs (same PR) | Revamp 2 | 15 m | build, one Kat decision | Kat asked for sub-tabs so the profile is not a long scroll. Overview, Loot, Gear, Wishlist, each with its own address so the bot's wishlist link keeps working. Kat then moved equipped gear onto the Overview, laid out like the in-game character pane (Kat's screenshot), so the Gear tab went |
| 3:45–3:55 PM | Profile gear card fix | Revamp 2 | 10 m | ~8 m build, ~2 m Kat review | Kat spotted scrollbars in the gear tables ("Champion" overflowed). Card moved to full width at Kat's suggestion, with a no-scroll test |
| 3:58–4:45 PM | #868 player profile, part 3: wishlist editor | Revamp 2 | 45 m | ~40 m build, ~5 m Kat deciding and reviewing | BiS or Pass by slot. Kat dropped notes and left M+/crafted picks read-only until #1166. Running the rules over 29 Phoenix wishlists found six raiders with both BiS trinkets saved under Trinket 1; they now read as one in each slot. Kat then moved the slots into one scrolling row of tabs and made editing computer-only (read-only on touch screens, not by width, so zoomed browsers still edit) |
| 8:08–9:00 PM | #868 player profile, part 4: Mark Received and M+ request | Revamp 2 | 50 m | ~45 m build, ~5 m Kat deciding | Both forms in dialogs, recorded from the current site first. Kat kept both usable on phones and let raiders see their own rejected M+ request (a new read rule). Recording showed the current site saves raid item receipts with their catalog slot, which the new loot priority list had been ignoring (43 of 73 live receipts). Kat then made the note required for Other, on both sites and in the database |
| 9:05–9:40 PM | #870 Roster page, part 2: spec icons, officer columns | Revamp 2 | 35 m | ~28 m build, ~7 m Kat deciding | Spec icons bundled (Kat), all 40 checked by eye; Devourer uses the Void icon. Kat kept attendance and items awarded officer-only to avoid loot drama, and dropped BiS obtained from the roster. Tightened cells so the officer columns fit without scrolling |
| 9:57–10:22 PM, 11:28–11:35 PM | #942 people table: re-plan, then step 1 | Revamp 2 (Identity prerequisite) | 30 m | ~25 m build, ~5 m Kat deciding and merging | Audit against production, six-step plan posted on #942. Kat chose alts listed on the person rather than as roster rows, kept the never-signed-in Immolation officer, and let officers see a two-team raider's other team name only. Step 1 (PR #1191) adds the table with nothing reading it yet. Rex checked the migration's guard against production before merge; from his review Kat ruled that Discord is never unlinked from an account |

### 2026-09-15

| Time (ET) | Item | Phase | Elapsed | Build / Kat | Notes |
| --- | --- | --- | ---: | --- | --- |
| 9:15–9:55 AM | #942 step 2: `guild_grants` | Revamp 2 (Identity prerequisite) | 40 m | ~35 m build, ~5 m Kat freeing the database port; review not yet counted | One table for the site admin, guild officer and BoE manager grants, the old names kept as read-only views. The migration refuses to run if a grant's account differs from its person's. Windows had reserved the local database port, which needed Kat to restart a Windows service as admin |

## Not counted (same sessions, not revamp)

| Date | Time (ET) | Item | Elapsed |
| --- | --- | --- | ---: |
| 2026-09-13 | 9:17–9:36 PM | Glizzygary wishlist lookup, then the missing Pending Roster audit entries (#1136, PR #1137) | 20 m |
| 2026-09-14 | 10:56–11:07 PM | Season dates decision on #1189: one start date for every team, from Blizzard's launch, no early rollovers (Season milestone) | 10 m |
| 2026-09-14 | 11:15–11:28 PM | Issue and pull request writing rules, new PR and issue templates (PR #1192) | 15 m |

## Remaining in Revamp 1

None. Revamp 1 finished 2026-09-14, all 11 issues closed, against a due date of 2026-10-31.
