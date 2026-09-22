-- #1269, third of three: seasonStart and seasonEnd leave team_settings.
--
-- team_settings.config ->> 'seasonStart' was the day a team's season began,
-- typed on the Season tab, and 'seasonEnd' an optional upper bound on the
-- same window. Everything that counted a season read them: the attendance
-- percentages on the roster and in the profile card, the new-raider nudge
-- and the onboarding checklist, the snapshot a close freezes, and the
-- attendance sync's report window. Decision 13 on #1189 (2026-09-20) made
-- the season app-wide with one set of dates, the tier's own, so the start
-- is derived rather than typed: team_season_start() (20260922000521)
-- answers the team's own first raid night in the tier, and the end is the
-- tier's ends_at.
--
-- Nothing reads either key any more. The sync fetches from the tier's start
-- since 20260922 (#1269's second pull request, v3.151.1), close_season()
-- has written the derived night as the entry's start since the first, and
-- every site and app reader moves onto the function in the bundle this file
-- ships with: seasonDateRangeFor(), seasonHasStarted() and
-- joinedAfterSeasonStart() in js/common.js, the Admin tab's Properties
-- panel, and the app's useCurrentSeason().
--
-- Production, 2026-09-22: team 1 holds 2026-08-11 and team 2 holds
-- 2026-08-18; teams 3 and 4 hold neither, and no team holds a seasonEnd.
-- The derived night is 2026-08-18 for teams 1, 2 and 3 and the tier's
-- 2026-08-11 for team 4, which has no report in the tier. No attendance row
-- exists before 2026-08-18, so no percentage moves; what changes is that a
-- raider who joined between 2026-08-11 and 2026-08-17 stops counting as a
-- mid-season join on teams 1 and 3, and that teams 3 and 4, which never
-- typed a date, have a season window at all.
--
-- A merge pushes this file before it publishes the site (#1083), so for up
-- to ten minutes a browser on the old bundle reads no dates: its attendance
-- counts the whole of history, its nudges hide, and a Save on its Season
-- Start box writes the key back. Every reader in the new bundle ignores the
-- key, so a row that gets it back is inert; the acceptance count is read
-- after the window.

update public.team_settings
set config = config - 'seasonStart' - 'seasonEnd'
where config ?| array['seasonStart', 'seasonEnd'];
