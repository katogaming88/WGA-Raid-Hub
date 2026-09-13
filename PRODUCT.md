# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Raiders** on a guild raid team. They open their own profile to check attendance, items received, their BiS list and wishlist, and where they stand in loot priority; they sign up for a season, RSVP to raid nights, request M+ exclusions, and self-report items received outside raid. Device mix (phone vs desktop) is not yet measured.
- **Officers and team leaders** run the team. They use the dashboard **mostly between raids, at a desk**: importing RCLootCouncil loot, building and checking the priority list, reviewing BiS submissions, signups, attendance, scoring and requests, and exporting priority back into RCLootCouncil for raid night. Confirmed by Kat, 2026-09-13; in-raid second-monitor use is not the primary scene.
- **Site admins** (Kat) manage teams and site-wide access.
- **Visitors** who don't raid with WGA yet, landing on the guild page to find a team, streams, news and signups.

## Product Purpose

A raid hub for a multi-team World of Warcraft guild: one place for the roster, loot fairness, loot priority, BiS and wishlists, attendance, signups, calendar and RSVPs, BoE sales, and the guild's public face. It exists to replace spreadsheets and Apps Script with something raiders can check themselves and officers can run a season from. Success is officers running loot and roster decisions from it without side spreadsheets, and raiders trusting what it tells them about their own standing.

## Positioning

Loot priority is built from this team's own data and closed back into the raid: RCLootCouncil imports in, BiS lists and per-item wishlists from raiders, WarcraftLogs performance and attendance, equipped gear synced from Blizzard, a priority order officers can edit, and an export string that goes straight back into RCLootCouncil. Loot, roster, signups and the calendar share one database per guild, with multiple raid teams under one guild.

## Operating Context

- WoW retail, current expansion Midnight. "Season" is the raid content cycle; "tier" means class tier-set gear only.
- Loot is distributed in raid through the RCLootCouncil addon, with a companion addon (RCLootCouncil_PriorityLoot) reading the exported priority.
- Sign-in is Discord only. The guild runs on Discord; a bot posts roster, BoE, RSVP and signup notifications there.
- Item data comes from Wowhead tooltips; performance from WarcraftLogs; gear from the Blizzard API; streams from Twitch.
- Teams today: Phoenix, Hellfire Rollers, Immolation, under the guild We Go Again (WGA).

## Capabilities and Constraints

- Being rebuilt as a single React + TypeScript app (tracking issue #1109), cutover targeted for January 2027. Backend is Supabase (Postgres, Auth, row-level security, Edge Functions).
- Per-team feature flags hide officer tools per team.
- Roles: raider, officer, team leader, guild officer, BoE manager, site admin; what a person sees depends on these.
- Difficulty and track matter everywhere loot appears (Heroic vs Mythic, upgrade tracks).
- Class and role colors are game-defined conventions raiders read instantly.
- Undecided: whether other guilds will use it (#1045, discussion #570).
- Wanted later, not scoped: teams and guilds uploading their own logo and banner (#1110).

## Brand Commitments

- The product is branded **WGA Raid Hub**. A guild or team using it appears as a subtitle under that brand, not as a replacement for it (Kat, 2026-09-13).
- The current visual look (dark ground, gold accent, Cinzel headings, flame emoji team icons) is **not binding**; it is open to replacement (Kat, 2026-09-13). The rebuild's chosen look is recorded on #1101.
- Existing assets: team header banners (`assets/banners/phoenix-header.png`, `hellfire-header.png`), officer bio photos (`assets/officers/`).

## Evidence on Hand

- Real roster, loot, priority, attendance and BoE data in production; restorable locally with `npm run db:snapshot`. Seed data for local work is thin (a couple of raiders per team).
- No testimonials, usage metrics, or customer list exist; none should be invented.

## Product Principles

1. **Raiders can check their own standing.** Anything that affects who gets loot is visible to the person it affects.
2. **Officers run the season from here, not a side spreadsheet.** Desk workflows (import, priority, review queues) come first in the dashboard.
3. **Game conventions beat invented ones.** Class colors, difficulty names, item quality and track names are used the way WoW players already read them.
4. **One guild, many teams.** Team is always clear, switching is cheap, and guild-wide things (BoE, streams, news) stay guild-wide.

## Accessibility & Inclusion

An accessibility suite already runs in CI (axe via Playwright, keyboard and reduced-motion tests under `tests/browser/`); the rebuild keeps that bar.
