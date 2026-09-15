-- #932: a seasons table and a foreign key on every season column.
--
-- Season lived in three places and none of them was a table: which tier is
-- current is CURRENT_SEASON in js/common.js, which cycle a team is on is a
-- key on team_settings.config, and the stamp on a row is free text in two
-- formats (the code MID2, the name Midnight Season 2) across fourteen
-- columns with no CHECK, no foreign key and no default. A misspelt or
-- invented season was written and found later by a report that came back
-- empty. docs/season-inventory.md (#931) is the reading this builds on.
--
-- 1. seasons: one row per raid tier, keyed by the code; the display name is
--    unique so the five name columns can reference it. Tiers are Blizzard's
--    calendar, the same for every guild, so there is no guild_id; a team's
--    own cycle is #939's team_seasons. The dates come from data/seasons.json,
--    the guild's record of when each tier ran. Tiers do not overlap, so at
--    most one row is open-ended: the next tier is a migration that closes
--    the outgoing row and inserts its own, and lands before any team names
--    the tier, because from here a name with no row refuses that team's
--    signups, finds, wishlist picks and BiS placeholders.
-- 2. A foreign key from each of the fourteen season columns: the nine code
--    columns to seasons(code), the five name columns to seasons(display_name).
--    Formats and stored values are unchanged; nulls stay allowed where they
--    were (boe_items, item_preferences and season_signups hold a few, #937
--    and #934 own those). #933 to #938 convert the name columns to codes.
--
-- Nothing here says which tier is current. raid_zones is one row per zone
-- and season shared by every team, and the site scopes a team's progress by
-- the team's own seasonName, so wcl-progression-sync keeps stamping that
-- name and skips a team with none rather than writing Unknown, which the key
-- refuses. The guild's current tier gets a definition with its first reader
-- (#937).

-- 1. seasons

create table public.seasons (
  code text primary key,
  display_name text not null,
  starts_at date not null,
  ends_at date,
  created_at timestamp with time zone not null default now(),
  constraint seasons_display_name_key unique (display_name),
  constraint seasons_window_check check (ends_at is null or ends_at >= starts_at)
);

comment on table public.seasons is
  'One row per raid tier (#932). code is the short form the priority, loot and scoring tables hold (MID2); display_name is what officers see and type (Midnight Season 2). Every season column references one of the two. A tier is added by a migration that closes the outgoing row and inserts the new one.';

comment on column public.seasons.starts_at is
  'The day the tier launched.';

comment on column public.seasons.ends_at is
  'Null while the tier is open-ended; the next tier''s migration sets it. Tiers do not overlap (seasons_no_overlap), so at most one row is null.';

-- Tiers do not overlap. The window is inclusive on both ends and an open-
-- ended row runs on without end, so a second open-ended row is refused until
-- the outgoing row is closed, which keeps the issue's "ends_at is null is
-- the current tier" true as a database fact.
alter table public.seasons
  add constraint seasons_no_overlap exclude using gist (daterange(starts_at, ends_at, '[]') with &&);

alter table public.seasons enable row level security;

-- Same trust model as raid_zones, tier_token_map and track_bonus_ids: a
-- world-visible lookup, no write policy, written by migrations.
create policy "Public read seasons" on public.seasons
  for select using (true);

create policy "Claude readers read seasons" on public.seasons
  for select to claude_readers using (true);

grant select on table public.seasons to anon;
grant select on table public.seasons to authenticated;
grant select on table public.seasons to claude_readers;

-- The two tiers the data holds, dated from data/seasons.json.
insert into public.seasons (code, display_name, starts_at, ends_at) values
  ('MID1', 'Midnight Season 1', '2026-03-17', '2026-08-10'),
  ('MID2', 'Midnight Season 2', '2026-08-11', null);

-- 2. The foreign keys. Code columns first, then the name columns.

alter table public.player_wcl_season_perf
  add constraint player_wcl_season_perf_season_fkey foreign key (season) references public.seasons (code);
alter table public.priority_conflict_dismissals
  add constraint priority_conflict_dismissals_season_fkey foreign key (season) references public.seasons (code);
alter table public.priority_order
  add constraint priority_order_season_fkey foreign key (season) references public.seasons (code);
alter table public.priority_order_confirmed_empty
  add constraint priority_order_confirmed_empty_season_fkey foreign key (season) references public.seasons (code);
alter table public.priority_stale_dismissals
  add constraint priority_stale_dismissals_season_fkey foreign key (season) references public.seasons (code);
alter table public.rclc_loot
  add constraint rclc_loot_season_fkey foreign key (season) references public.seasons (code);
alter table public.scoring
  add constraint scoring_season_fkey foreign key (season) references public.seasons (code);
alter table public.tier_token_map
  add constraint tier_token_map_season_fkey foreign key (season) references public.seasons (code);
alter table public.track_bonus_ids
  add constraint track_bonus_ids_season_fkey foreign key (season) references public.seasons (code);

alter table public.bis_items
  add constraint bis_items_season_fkey foreign key (season) references public.seasons (display_name);
alter table public.boe_items
  add constraint boe_items_season_fkey foreign key (season) references public.seasons (display_name);
alter table public.item_preferences
  add constraint item_preferences_season_fkey foreign key (season) references public.seasons (display_name);
alter table public.raid_zones
  add constraint raid_zones_season_fkey foreign key (season) references public.seasons (display_name);
alter table public.season_signups
  add constraint season_signups_season_fkey foreign key (season) references public.seasons (display_name);
