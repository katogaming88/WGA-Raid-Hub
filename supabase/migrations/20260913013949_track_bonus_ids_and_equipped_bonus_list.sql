-- Gear upgrade track, read from the item's own bonus IDs instead of guessed
-- from item level.
--
-- player_equipped_gear.track has always been inferred by comparing
-- item_level against team_settings.config.trackIlvlThresholds (see
-- 20260831172900_player_equipped_gear.sql and blizzard-gear-sync's
-- deriveTrack()). That cannot work, because the tracks genuinely overlap in
-- item level by design: Hero 6/6 and Myth 2/6 are both 321, and Champion 6/6
-- and Hero 2/6 are both 308. With this guild's configured Myth floor of 318,
-- every fully-upgraded Hero item (321) reads as "Myth".
--
-- Measured live against the real roster before writing this (54 characters,
-- 889 equipped items): only 351 of the 712 items carrying a track bonus ID
-- were classified correctly. 286 Hero items read as Myth and 75 Champion
-- items read as Hero, and 53 of the 54 characters held at least one
-- wrongly-"Myth" item. Since generate_priority_order() removes a candidate
-- outright when it thinks they already own the item on Myth, that silently
-- pulled people off priority lists they belonged on.
--
-- The reliable signal is the item's bonus IDs, which encode track and
-- upgrade rank exactly -- verified live that each maps to precisely one item
-- level (12846 -> 321 across 260 observations, 12854 -> 334 across 77).
-- This repo already decodes them for RCLootCouncil imports
-- (20260829200033_import_rclc_loot_bonus_id_track.sql), but as plpgsql
-- constants private to that function; the Blizzard Character Equipment
-- Summary endpoint returns the same vocabulary as a `bonus_list` array per
-- equipped item, so the mapping now needs to be readable from two places.
-- Hence a table rather than a second copy of the constants.
--
-- Deliberately NOT keyed/filtered on season, unlike the season column this
-- table's row data records. Blizzard allocates a fresh block of bonus IDs
-- each tier rather than reusing old ones, so rows from different seasons
-- cannot collide, and a lookup that ignores season keeps working when MID3's
-- block is appended -- no code change, no cutover, and none of the "worked
-- until the season rolled and then silently matched nothing" failure mode
-- tier_token_map has (it has no season column at all and needs a manual
-- re-seed). The season column is provenance, so a future maintainer can see
-- which tier a block came from.
--
-- Do NOT use the Blizzard API's name_description string for this. It is a
-- source/difficulty label, not the track, and it is noisy in practice
-- ("Mythic+", "Heroic", "Timewarped", "Venomcursed", none at all) -- a
-- single track and rank shows up under many different values, and
-- Myth-track items frequently read "Heroic". An earlier attempt at that
-- field was already abandoned for a different reason (#845).
create table public.track_bonus_ids (
  bonus_id integer primary key,
  track text not null,
  rank smallint not null,
  season text not null,
  created_at timestamp with time zone not null default now()
);

comment on table public.track_bonus_ids is
  'Maps a WoW item bonus ID to its gear upgrade track and rank (e.g. 12853 -> Myth 5/6). Read by blizzard-gear-sync when syncing equipped gear, and the intended future home of the constants currently inlined in import_rclc_loot(). Seeded by hand per tier -- append the new block, never edit or delete old rows, since older gear keeps its original bonus IDs.';

comment on column public.track_bonus_ids.season is
  'Provenance only -- which tier this block was allocated for. Lookups deliberately ignore it; Blizzard issues a fresh ID block each tier so rows cannot collide across seasons.';

alter table public.track_bonus_ids enable row level security;

-- Same trust model as items/tier_token_map: pure catalog reference data, no
-- per-team or per-player scoping, world-visible.
create policy "Public read track_bonus_ids" on public.track_bonus_ids
  for select using (true);

create policy "Claude readers read track_bonus_ids" on public.track_bonus_ids
  for select to claude_readers using (true);

grant select on table public.track_bonus_ids to anon;
grant select on table public.track_bonus_ids to authenticated;
grant select on table public.track_bonus_ids to claude_readers;

-- Midnight Season 2 (12.1). Same three blocks import_rclc_loot() already
-- carries, cross-checked against live roster data: the implied item levels
-- (Champion capping at 308, Hero 305-321, Myth 318-334) line up with the
-- published per-track ranges for this tier, including the documented
-- Hero 6/6 = Myth 2/6 = 321 overlap that broke the ilvl guess.
insert into public.track_bonus_ids (bonus_id, track, rank, season) values
  (12833, 'Champion', 1, 'MID2'),
  (12834, 'Champion', 2, 'MID2'),
  (12835, 'Champion', 3, 'MID2'),
  (12836, 'Champion', 4, 'MID2'),
  (12837, 'Champion', 5, 'MID2'),
  (12838, 'Champion', 6, 'MID2'),
  (12841, 'Hero', 1, 'MID2'),
  (12842, 'Hero', 2, 'MID2'),
  (12843, 'Hero', 3, 'MID2'),
  (12844, 'Hero', 4, 'MID2'),
  (12845, 'Hero', 5, 'MID2'),
  (12846, 'Hero', 6, 'MID2'),
  (12849, 'Myth', 1, 'MID2'),
  (12850, 'Myth', 2, 'MID2'),
  (12851, 'Myth', 3, 'MID2'),
  (12852, 'Myth', 4, 'MID2'),
  (12853, 'Myth', 5, 'MID2'),
  (12854, 'Myth', 6, 'MID2'),
  -- The last two Mythic bosses' special higher drops, above the normal 6/6
  -- ceiling -- carried as rank 9 in import_rclc_loot()'s existing comment.
  (13848, 'Myth', 9, 'MID2');

-- The raw bonus IDs as synced, so a track can be re-derived later (a
-- corrected seed row, a newly appended season block) without waiting for the
-- next full Blizzard sweep to overwrite every row.
alter table public.player_equipped_gear add column bonus_list integer[];

comment on column public.player_equipped_gear.bonus_list is
  'The item''s bonus IDs exactly as the Blizzard Character Equipment Summary returned them. track is derived from these via track_bonus_ids; kept raw so it can be re-derived without a re-sync.';

comment on column public.player_equipped_gear.track is
  'Gear upgrade track (Explorer/Adventurer/Veteran/Champion/Hero/Myth), derived from bonus_list via track_bonus_ids. Falls back to the item_level-vs-trackIlvlThresholds guess only when no bonus ID matches (crafted, Timewarped and similar gear carries no track bonus ID) -- that fallback cannot distinguish overlapping tracks and is a last resort, not the primary source.';
