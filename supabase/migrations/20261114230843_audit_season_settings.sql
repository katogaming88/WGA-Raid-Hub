-- #1633: what the roster audit (#1261) checks a season's gear against: which
-- slots take an enchant, which enchants and gems are this expansion's, and how
-- each crest's weekly cap works. Reference rows, the way tier_token_map and
-- season_track_floors work: added by the migration that adds a season, never
-- edited by a team, and an old season keeps its rows, so a past week is still
-- checked against what was true that week.
--
-- * season_enchant_slots: the slots that take an enchant, each with an
--   optional date it starts counting (a slot added mid-season is not expected
--   before then). OFF_HAND counts only when the item there is a weapon; the
--   audit decides that from the item.
-- * season_enchants: the enchants that count, by Blizzard's enchantment id
--   (what the profile API returns). top_rank: the higher of its two ranks.
--   tertiary: speed, leech or avoidance (with or without stamina), which the
--   Lenient rule takes at any rank. An enchant not listed counts as none.
-- * season_gems: the gems that count, by Blizzard's item id, with top_rank (Flawless) and
--   epic (the Eversong Diamonds and Heliotropes).
-- * season_crests: each crest type: capped or not, the first week its cap
--   counts, how much the cap grows each week, sources that never count toward
--   it, and the date Blizzard lifted the caps.
-- * season_enchant_slots_on() and season_crest_cap() read them for a day or a
--   week, so the audit and its tests agree on the dates.
--
-- Midnight Season 2's rows, the season being raided. Enchant ids and ranks
-- come from Blizzard's SpellItemEnchantment table (the Midnight "Quality-12"
-- enchants, permanent ones only: no oils, whetstones, tools or cosmetics);
-- gems from the game's item data; the Mistcrests' 100 a week and their
-- currency ids from the currency table; the season's first week (2026-08-18)
-- and the caps' lifting with the 2026-10-20 hotfix from the season's notes.
-- Midnight Season 3 gets its rows when it is dated.

create table public.season_enchant_slots (
  season text not null references public.seasons (code),
  slot text not null check (slot in ('MAIN_HAND', 'OFF_HAND', 'HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST',
                                     'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2')),
  counts_from date,
  primary key (season, slot)
);

comment on table public.season_enchant_slots is
  'The slots that take an enchant in a season (#1633), in player_equipped_gear''s slot names. counts_from: the day a slot added mid-season starts counting (null: the whole season). OFF_HAND counts only when the item is a weapon. Added by migration.';

create table public.season_enchants (
  season text not null references public.seasons (code),
  enchantment_id integer not null check (enchantment_id > 0),
  name text not null check (name ~ '\S'),
  slot text not null check (slot in ('WEAPON', 'HEAD', 'SHOULDER', 'CHEST', 'LEGS', 'FEET', 'FINGER')),
  top_rank boolean not null,
  tertiary boolean not null,
  primary key (season, enchantment_id)
);

comment on table public.season_enchants is
  'The enchants that count in a season (#1633), by Blizzard''s enchantment id. top_rank: the higher rank. tertiary: speed, leech or avoidance only, which the Lenient rule takes at any rank. An enchant not listed (an older expansion''s) counts as none. Added by migration.';

create table public.season_gems (
  season text not null references public.seasons (code),
  wow_item_id integer not null check (wow_item_id > 0),
  name text not null check (name ~ '\S'),
  top_rank boolean not null,
  epic boolean not null,
  primary key (season, wow_item_id)
);

comment on table public.season_gems is
  'The gems that count in a season (#1633), by Blizzard''s item id (wow_item_id, not items.id). top_rank: the higher rank (Flawless; a gem with one rank is top). epic: an epic gem, which the audit checks for. A gem not listed counts as none. Added by migration.';

create table public.season_crests (
  season text not null references public.seasons (code),
  track text not null check (track in ('Adventurer', 'Veteran', 'Champion', 'Hero', 'Myth')),
  name text not null check (name ~ '\S'),
  currency_id integer check (currency_id > 0),
  capped boolean not null,
  first_week date,
  weekly_increase integer check (weekly_increase > 0),
  uncapped_sources text[] not null default '{}',
  caps_lifted_on date,
  primary key (season, track),
  constraint season_crests_capped check (not capped or (first_week is not null and weekly_increase is not null))
);

comment on table public.season_crests is
  'Each upgrade crest in a season (#1633). A capped crest''s cap grows by weekly_increase every week from first_week (a reset Tuesday), so a missed week carries over; uncapped_sources never count toward it; from caps_lifted_on (Blizzard usually lifts every cap in the x.x.5 patch) it has none. Read through season_crest_cap(). Added by migration.';

alter table public.season_enchant_slots owner to postgres;
alter table public.season_enchant_slots enable row level security;
alter table public.season_enchants owner to postgres;
alter table public.season_enchants enable row level security;
alter table public.season_gems owner to postgres;
alter table public.season_gems enable row level security;
alter table public.season_crests owner to postgres;
alter table public.season_crests enable row level security;

-- Reference data, like season_track_floors: anyone reads, nobody writes but
-- migrations.
create policy "Public read season_enchant_slots" on public.season_enchant_slots for select using (true);
create policy "Public read season_enchants" on public.season_enchants for select using (true);
create policy "Public read season_gems" on public.season_gems for select using (true);
create policy "Public read season_crests" on public.season_crests for select using (true);
create policy "Claude readers read season_enchant_slots" on public.season_enchant_slots
  for select to claude_readers using (true);
create policy "Claude readers read season_enchants" on public.season_enchants
  for select to claude_readers using (true);
create policy "Claude readers read season_gems" on public.season_gems
  for select to claude_readers using (true);
create policy "Claude readers read season_crests" on public.season_crests
  for select to claude_readers using (true);

revoke all on table public.season_enchant_slots from public, anon, authenticated, service_role;
grant select on table public.season_enchant_slots to anon, authenticated, service_role;
revoke all on table public.season_enchants from public, anon, authenticated, service_role;
grant select on table public.season_enchants to anon, authenticated, service_role;
revoke all on table public.season_gems from public, anon, authenticated, service_role;
grant select on table public.season_gems to anon, authenticated, service_role;
revoke all on table public.season_crests from public, anon, authenticated, service_role;
grant select on table public.season_crests to anon, authenticated, service_role;

-- The slots a season expects enchanted on a day: a slot with a later
-- counts_from is not expected yet.
create function public.season_enchant_slots_on(p_season text, p_day date)
returns setof text
language sql
stable
set search_path = public
as $$
  select s.slot
    from season_enchant_slots s
   where s.season = p_season and (s.counts_from is null or s.counts_from <= p_day)
   order by s.slot;
$$;

comment on function public.season_enchant_slots_on(text, date) is
  'The slots a season expects enchanted on a day (#1633): its season_enchant_slots, less any whose counts_from is later.';

revoke all on function public.season_enchant_slots_on(text, date) from public;
grant execute on function public.season_enchant_slots_on(text, date) to anon, authenticated, service_role;

-- A crest's cap for the week that starts on p_week (its reset Tuesday): null
-- when it has none (uncapped, or the caps are lifted), 0 before its first
-- week, else weekly_increase for each week from first_week through p_week.
-- No row: null.
create function public.season_crest_cap(p_season text, p_track text, p_week date)
returns integer
language sql
stable
set search_path = public
as $$
  select case
           when not c.capped or (c.caps_lifted_on is not null and p_week >= c.caps_lifted_on) then null
           when p_week < c.first_week then 0
           else c.weekly_increase * ((p_week - c.first_week) / 7 + 1)
         end
    from season_crests c
   where c.season = p_season and c.track = p_track;
$$;

comment on function public.season_crest_cap(text, text, date) is
  'A crest''s total cap for the week starting p_week (#1633): null when it has none (uncapped or lifted), 0 before its first week, else weekly_increase per week from first_week through p_week.';

revoke all on function public.season_crest_cap(text, text, date) from public;
grant execute on function public.season_crest_cap(text, text, date) to anon, authenticated, service_role;

insert into public.season_enchant_slots (season, slot) values
  ('MID2', 'MAIN_HAND'),
  ('MID2', 'OFF_HAND'),
  ('MID2', 'HEAD'),
  ('MID2', 'SHOULDER'),
  ('MID2', 'CHEST'),
  ('MID2', 'LEGS'),
  ('MID2', 'FEET'),
  ('MID2', 'FINGER_1'),
  ('MID2', 'FINGER_2');

insert into public.season_enchants (season, enchantment_id, name, slot, top_rank, tertiary) values
  ('MID2', 7934, 'Sunfire Silk Spellthread', 'LEGS', false, false),
  ('MID2', 7935, 'Sunfire Silk Spellthread', 'LEGS', true, false),
  ('MID2', 7936, 'Arcanoweave Spellthread', 'LEGS', false, false),
  ('MID2', 7937, 'Arcanoweave Spellthread', 'LEGS', true, false),
  ('MID2', 7938, 'Bright Linen Spellthread', 'LEGS', false, false),
  ('MID2', 7939, 'Bright Linen Spellthread', 'LEGS', true, false),
  ('MID2', 7956, 'Mark of Nalorakk', 'CHEST', false, false),
  ('MID2', 7957, 'Mark of Nalorakk', 'CHEST', true, false),
  ('MID2', 7958, 'Hex of Leeching', 'HEAD', false, true),
  ('MID2', 7959, 'Hex of Leeching', 'HEAD', true, true),
  ('MID2', 7960, 'Empowered Hex of Leeching', 'HEAD', false, true),
  ('MID2', 7961, 'Empowered Hex of Leeching', 'HEAD', true, true),
  ('MID2', 7962, 'Lynx''s Dexterity', 'FEET', false, true),
  ('MID2', 7963, 'Lynx''s Dexterity', 'FEET', true, true),
  ('MID2', 7964, 'Amani Mastery', 'FINGER', false, false),
  ('MID2', 7965, 'Amani Mastery', 'FINGER', true, false),
  ('MID2', 7966, 'Eyes of the Eagle', 'FINGER', false, false),
  ('MID2', 7967, 'Eyes of the Eagle', 'FINGER', true, false),
  ('MID2', 7968, 'Zul''jin''s Mastery', 'FINGER', false, false),
  ('MID2', 7969, 'Zul''jin''s Mastery', 'FINGER', true, false),
  ('MID2', 7970, 'Flight of the Eagle', 'SHOULDER', false, true),
  ('MID2', 7971, 'Flight of the Eagle', 'SHOULDER', true, true),
  ('MID2', 7972, 'Akil''zon''s Swiftness', 'SHOULDER', false, true),
  ('MID2', 7973, 'Akil''zon''s Swiftness', 'SHOULDER', true, true),
  ('MID2', 7978, 'Strength of Halazzi', 'WEAPON', false, false),
  ('MID2', 7979, 'Strength of Halazzi', 'WEAPON', true, false),
  ('MID2', 7980, 'Jan''alai''s Precision', 'WEAPON', false, false),
  ('MID2', 7981, 'Jan''alai''s Precision', 'WEAPON', true, false),
  ('MID2', 7982, 'Berserker''s Rage', 'WEAPON', false, false),
  ('MID2', 7983, 'Berserker''s Rage', 'WEAPON', true, false),
  ('MID2', 7984, 'Mark of the Rootwarden', 'CHEST', false, false),
  ('MID2', 7985, 'Mark of the Rootwarden', 'CHEST', true, false),
  ('MID2', 7986, 'Mark of the Worldsoul', 'CHEST', false, false),
  ('MID2', 7987, 'Mark of the Worldsoul', 'CHEST', true, false),
  ('MID2', 7988, 'Blessing of Speed', 'HEAD', false, true),
  ('MID2', 7989, 'Blessing of Speed', 'HEAD', true, true),
  ('MID2', 7990, 'Empowered Blessing of Speed', 'HEAD', false, true),
  ('MID2', 7991, 'Empowered Blessing of Speed', 'HEAD', true, true),
  ('MID2', 7992, 'Shaladrassil''s Roots', 'FEET', false, true),
  ('MID2', 7993, 'Shaladrassil''s Roots', 'FEET', true, true),
  ('MID2', 7994, 'Nature''s Wrath', 'FINGER', false, false),
  ('MID2', 7995, 'Nature''s Wrath', 'FINGER', true, false),
  ('MID2', 7996, 'Nature''s Fury', 'FINGER', false, false),
  ('MID2', 7997, 'Nature''s Fury', 'FINGER', true, false),
  ('MID2', 7998, 'Nature''s Grace', 'SHOULDER', false, true),
  ('MID2', 7999, 'Nature''s Grace', 'SHOULDER', true, true),
  ('MID2', 8000, 'Amirdrassil''s Grace', 'SHOULDER', false, true),
  ('MID2', 8001, 'Amirdrassil''s Grace', 'SHOULDER', true, true),
  ('MID2', 8006, 'Worldsoul Cradle', 'WEAPON', false, false),
  ('MID2', 8007, 'Worldsoul Cradle', 'WEAPON', true, false),
  ('MID2', 8008, 'Worldsoul Aegis', 'WEAPON', false, false),
  ('MID2', 8009, 'Worldsoul Aegis', 'WEAPON', true, false),
  ('MID2', 8010, 'Worldsoul Tenacity', 'WEAPON', false, false),
  ('MID2', 8011, 'Worldsoul Tenacity', 'WEAPON', true, false),
  ('MID2', 8012, 'Mark of the Magister', 'CHEST', false, false),
  ('MID2', 8013, 'Mark of the Magister', 'CHEST', true, false),
  ('MID2', 8014, 'Rune of Avoidance', 'HEAD', false, true),
  ('MID2', 8015, 'Rune of Avoidance', 'HEAD', true, true),
  ('MID2', 8016, 'Empowered Rune of Avoidance', 'HEAD', false, true),
  ('MID2', 8017, 'Empowered Rune of Avoidance', 'HEAD', true, true),
  ('MID2', 8018, 'Farstrider''s Hunt', 'FEET', false, true),
  ('MID2', 8019, 'Farstrider''s Hunt', 'FEET', true, true),
  ('MID2', 8020, 'Thalassian Haste', 'FINGER', false, false),
  ('MID2', 8021, 'Thalassian Haste', 'FINGER', true, false),
  ('MID2', 8022, 'Thalassian Versatility', 'FINGER', false, false),
  ('MID2', 8023, 'Thalassian Versatility', 'FINGER', true, false),
  ('MID2', 8024, 'Silvermoon''s Alacrity', 'FINGER', false, false),
  ('MID2', 8025, 'Silvermoon''s Alacrity', 'FINGER', true, false),
  ('MID2', 8026, 'Silvermoon''s Tenacity', 'FINGER', false, false),
  ('MID2', 8027, 'Silvermoon''s Tenacity', 'FINGER', true, false),
  ('MID2', 8028, 'Thalassian Recovery', 'SHOULDER', false, true),
  ('MID2', 8029, 'Thalassian Recovery', 'SHOULDER', true, true),
  ('MID2', 8030, 'Silvermoon''s Mending', 'SHOULDER', false, true),
  ('MID2', 8031, 'Silvermoon''s Mending', 'SHOULDER', true, true),
  ('MID2', 8036, 'Flames of the Sin''dorei', 'WEAPON', false, false),
  ('MID2', 8037, 'Flames of the Sin''dorei', 'WEAPON', true, false),
  ('MID2', 8038, 'Acuity of the Ren''dorei', 'WEAPON', false, false),
  ('MID2', 8039, 'Acuity of the Ren''dorei', 'WEAPON', true, false),
  ('MID2', 8040, 'Arcane Mastery', 'WEAPON', false, false),
  ('MID2', 8041, 'Arcane Mastery', 'WEAPON', true, false),
  ('MID2', 8158, 'Forest Hunter''s Armor Kit', 'LEGS', false, false),
  ('MID2', 8159, 'Forest Hunter''s Armor Kit', 'LEGS', true, false),
  ('MID2', 8160, 'Thalassian Scout Armor Kit', 'LEGS', false, false),
  ('MID2', 8161, 'Thalassian Scout Armor Kit', 'LEGS', true, false),
  ('MID2', 8162, 'Blood Knight''s Armor Kit', 'LEGS', false, false),
  ('MID2', 8163, 'Blood Knight''s Armor Kit', 'LEGS', true, false),
  ('MID2', 8612, 'Smuggler''s Lynxeye', 'WEAPON', false, false),
  ('MID2', 8613, 'Smuggler''s Lynxeye', 'WEAPON', true, false),
  ('MID2', 8614, 'Farstrider''s Hawkeye', 'WEAPON', false, false),
  ('MID2', 8615, 'Farstrider''s Hawkeye', 'WEAPON', true, false),
  ('MID2', 8688, 'Rite of the Hash''ey', 'WEAPON', false, false),
  ('MID2', 8689, 'Rite of the Hash''ey', 'WEAPON', true, false);

insert into public.season_gems (season, wow_item_id, name, top_rank, epic) values
  ('MID2', 240983, 'Indecipherable Eversong Diamond', true, true),
  ('MID2', 240967, 'Powerful Eversong Diamond', true, true),
  ('MID2', 240971, 'Stoic Eversong Diamond', true, true),
  ('MID2', 240969, 'Telluric Eversong Diamond', true, true),
  ('MID2', 241142, 'Determined Heliotrope', true, true),
  ('MID2', 241143, 'Cognitive Heliotrope', true, true),
  ('MID2', 241144, 'Enduring Heliotrope', true, true),
  ('MID2', 240912, 'Flawless Versatile Lapis', true, false),
  ('MID2', 240916, 'Flawless Quick Lapis', true, false),
  ('MID2', 240914, 'Flawless Deadly Lapis', true, false),
  ('MID2', 240918, 'Flawless Masterful Lapis', true, false),
  ('MID2', 240880, 'Versatile Lapis', false, false),
  ('MID2', 240884, 'Quick Lapis', false, false),
  ('MID2', 240882, 'Deadly Lapis', false, false),
  ('MID2', 240886, 'Masterful Lapis', false, false),
  ('MID2', 240888, 'Flawless Quick Peridot', true, false),
  ('MID2', 240894, 'Flawless Versatile Peridot', true, false),
  ('MID2', 240890, 'Flawless Deadly Peridot', true, false),
  ('MID2', 240892, 'Flawless Masterful Peridot', true, false),
  ('MID2', 240856, 'Quick Peridot', false, false),
  ('MID2', 240862, 'Versatile Peridot', false, false),
  ('MID2', 240858, 'Deadly Peridot', false, false),
  ('MID2', 240860, 'Masterful Peridot', false, false),
  ('MID2', 240904, 'Flawless Deadly Garnet', true, false),
  ('MID2', 240910, 'Flawless Versatile Garnet', true, false),
  ('MID2', 240906, 'Flawless Quick Garnet', true, false),
  ('MID2', 240908, 'Flawless Masterful Garnet', true, false),
  ('MID2', 240872, 'Deadly Garnet', false, false),
  ('MID2', 240878, 'Versatile Garnet', false, false),
  ('MID2', 240874, 'Quick Garnet', false, false),
  ('MID2', 240876, 'Masterful Garnet', false, false),
  ('MID2', 240896, 'Flawless Masterful Amethyst', true, false),
  ('MID2', 240902, 'Flawless Versatile Amethyst', true, false),
  ('MID2', 240900, 'Flawless Quick Amethyst', true, false),
  ('MID2', 240898, 'Flawless Deadly Amethyst', true, false),
  ('MID2', 240864, 'Masterful Amethyst', false, false),
  ('MID2', 240870, 'Versatile Amethyst', false, false),
  ('MID2', 240868, 'Quick Amethyst', false, false),
  ('MID2', 240866, 'Deadly Amethyst', false, false);

insert into public.season_crests
  (season, track, name, currency_id, capped, first_week, weekly_increase, caps_lifted_on) values
  ('MID2', 'Adventurer', 'Adventurer Mistcrest', 3442, true, '2026-08-18', 100, '2026-10-20'),
  ('MID2', 'Veteran', 'Veteran Mistcrest', 3443, true, '2026-08-18', 100, '2026-10-20'),
  ('MID2', 'Champion', 'Champion Mistcrest', 3444, true, '2026-08-18', 100, '2026-10-20'),
  ('MID2', 'Hero', 'Hero Mistcrest', 3445, true, '2026-08-18', 100, '2026-10-20'),
  ('MID2', 'Myth', 'Myth Mistcrest', 3446, true, '2026-08-18', 100, '2026-10-20');
