-- #1267: a tier's item level floor for each gear track lives on the tier, not
-- copied into each team's settings by hand.
--
-- blizzard-gear-sync takes an equipped item's track from its bonus ids
-- (track_bonus_ids) and falls back to these floors only for gear that carries
-- no track bonus id (crafted, Timewarped and the like). Until now it read the
-- floors from team_settings.config.trackIlvlThresholds, which two of the four
-- teams held, so the other two got no track on that gear. Blizzard sets the
-- floors once per tier for everyone, so they are rows keyed by tier and track,
-- added by the migration that adds a tier, the way its dates are. A table
-- rather than six columns or a JSON object so that a mistyped track is
-- refused rather than silently never matching.
--
-- Midnight Season 2's values are the ones both teams held on 2026-09-30,
-- identical on each, taken from WoWAudit's per-tier config (#845). Midnight
-- Season 1 gets none: the floors were first entered on 2026-08-31, after it
-- ended, and the sync only reads the current tier.

create table public.season_track_floors (
  season text not null references public.seasons (code),
  track text not null check (track in ('Myth', 'Hero', 'Champion', 'Veteran', 'Adventurer', 'Explorer')),
  item_level integer not null check (item_level > 0),
  created_at timestamp with time zone not null default now(),
  primary key (season, track)
);

comment on table public.season_track_floors is
  'The lowest item level of each gear upgrade track in a tier (#1267). blizzard-gear-sync grades equipped gear that carries no track bonus id against the current tier''s floors, highest track first. Added by the migration that adds the tier.';

alter table public.season_track_floors enable row level security;

-- Same trust model as track_bonus_ids: catalog reference data, world-visible,
-- no write policy.
create policy "Public read season_track_floors" on public.season_track_floors
  for select using (true);

create policy "Claude readers read season_track_floors" on public.season_track_floors
  for select to claude_readers using (true);

grant select on table public.season_track_floors to anon;
grant select on table public.season_track_floors to authenticated;
grant select on table public.season_track_floors to claude_readers;

insert into public.season_track_floors (season, track, item_level) values
  ('MID2', 'Myth', 318),
  ('MID2', 'Hero', 305),
  ('MID2', 'Champion', 292),
  ('MID2', 'Veteran', 279),
  ('MID2', 'Adventurer', 266),
  ('MID2', 'Explorer', 207);

comment on column public.player_equipped_gear.track is
  'Gear upgrade track (Explorer/Adventurer/Veteran/Champion/Hero/Myth), derived from bonus_list via track_bonus_ids. Falls back to the item level against the current tier''s season_track_floors only when no bonus ID matches (crafted, Timewarped and similar gear carries no track bonus ID) -- that fallback cannot distinguish overlapping tracks and is a last resort, not the primary source.';
