-- #932: a seasons table, a foreign key on every season column, and one
-- definition of the guild's current tier.
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
--    the guild's record of when each tier ran. A tier is a migration: the
--    next one closes the outgoing row and inserts its own, and lands before
--    any team names the tier, because from here a name with no row refuses
--    that team's signups, finds, wishlist picks and BiS placeholders.
-- 2. current_season(): the latest tier whose starts_at has passed. Not
--    "ends_at is null", because milestone 29 lets a team roll its cycle
--    over before a tier launches (Hellfire stamped Season 2 rows from 08-07
--    for an 08-22 start), which needs the next tier's row to exist ahead of
--    launch without it becoming current the moment it lands. With a future
--    starts_at the outgoing tier stays current even after its ends_at, so
--    there is never a gap. At most one row is open-ended, which keeps the
--    issue's "ends_at is null is the current tier" true as a database fact.
-- 3. A foreign key from each of the fourteen season columns: the nine code
--    columns to seasons(code), the five name columns to seasons(display_name).
--    Formats and stored values are unchanged; nulls stay allowed where they
--    were (boe_items, item_preferences and season_signups hold a few, #937
--    and #934 own those). #933 to #938 convert the name columns to codes.
-- 4. wcl-progression-sync reads current_season() for the raid_zones stamp
--    instead of the syncing team's seasonName, so the Unknown stamp is gone.

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
  'The day the tier launched. current_season() is the latest row whose starts_at has passed, so a row landed early with a future date does not become current until then.';

comment on column public.seasons.ends_at is
  'Null while the tier is open-ended; the next tier''s migration sets it. At most one row is null (seasons_one_open_ended).';

-- The issue's invariant, kept as a database fact: exactly one tier has no
-- end, and a second one is refused until the outgoing row is closed.
create unique index seasons_one_open_ended on public.seasons ((true)) where ends_at is null;

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

-- 2. current_season()

-- Today in America/New_York, the project's zone (the add_signup_to_roster
-- idiom), so a tier launching on a Tuesday is current from the Eastern
-- morning rather than from 20:00 the evening before.
create or replace function public.current_season()
returns setof public.seasons
language sql stable security invoker
set search_path = public
as $$
  select *
  from public.seasons
  where starts_at <= (now() at time zone 'America/New_York')::date
  order by starts_at desc
  limit 1
$$;

comment on function public.current_season() is
  'The guild''s current raid tier: the latest seasons row whose starts_at has passed (#932). One row once any tier has started, none before. wcl-progression-sync stamps raid_zones from it.';

grant execute on function public.current_season() to anon, authenticated;

-- 3. The foreign keys. Code columns first, then the name columns.

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
