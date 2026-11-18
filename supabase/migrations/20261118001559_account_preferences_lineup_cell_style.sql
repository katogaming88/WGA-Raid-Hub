-- #1681: the Boss Lineup grid has two cell styles, Names and Solid bars, and
-- each officer picks their own. The pick is a view setting for that one
-- account (Kat, 2026-11-18: per account, so it follows them to every
-- device), so it is a new key in account_preferences (#940) rather than a
-- table or a team setting.
--
-- Guild-wide (team_id null): the same officer reading two teams' lineups
-- wants one look. The value is the style's name as a JSON string, and the
-- CHECK holds it to the two styles the page knows, so a typo fails here
-- instead of showing the default.

alter table public.account_preferences
  drop constraint account_preferences_known_key;

alter table public.account_preferences
  add constraint account_preferences_known_key check (
    (key = 'no_character_dismissed' and team_id is null)
    or (key = 'notifications_cleared_through' and team_id is not null)
    or (key = 'lineup_cell_style' and team_id is null and value in ('"names"'::jsonb, '"bars"'::jsonb))
  );
