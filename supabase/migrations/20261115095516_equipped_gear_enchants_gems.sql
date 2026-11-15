-- #1634: the gear sync keeps what the roster audit (#1261) checks on each
-- slot. blizzard-gear-sync already reads all of it from the Character
-- Equipment Summary; until now it saved only the item, level, track and bonus
-- ids. Current gear only: past weeks keep counts on character_weeks.
--
-- * enchantment_id: the permanent enchant's Blizzard enchantment id, the key
--   of season_enchants. Oils, whetstones and Illusory Adornments are
--   temporary and never stored, so a weapon with only an oil reads null.
-- * gem_wow_item_ids: one entry per socket the item has, in order, null for
--   an empty socket; [] for an item with none. Read from the item, never
--   assumed from the slot. Blizzard item ids, the id space of
--   season_gems.wow_item_id.
-- * embellished, crafted: the reply has no flag for either; the sync reads
--   the "Embellished" equip limit and the crafter's picked stats or a
--   "Crafted" label.
-- * upgrade_rank, upgrade_max: the step on its track (Hero 4 of 6), from the
--   same track bonus id that gives track. Null when no track bonus id matched
--   (crafted gear, or the item-level fallback). The top step is the end of
--   the track's unbroken run of steps from 1, so the last two Mythic bosses'
--   special drop (Myth rank 9, bonus 13848) reads 9 of 6, as the game shows
--   it, and is the one case where the step passes the top.
--
-- Rows already on file get the defaults and fill in on the next sync.

alter table public.player_equipped_gear
  add column enchantment_id integer check (enchantment_id > 0),
  add column gem_wow_item_ids integer[] not null default '{}',
  add column embellished boolean not null default false,
  add column crafted boolean not null default false,
  add column upgrade_rank smallint check (upgrade_rank > 0),
  add column upgrade_max smallint check (upgrade_max > 0),
  add constraint player_equipped_gear_upgrade_step_check check (
    (upgrade_rank is null) = (upgrade_max is null)
  );

comment on column public.player_equipped_gear.enchantment_id is
  'The permanent enchant''s Blizzard enchantment id (season_enchants.enchantment_id), null when there is none. Temporary ones (oils, whetstones, Illusory Adornments) are never stored. Synced by blizzard-gear-sync (#1634).';
comment on column public.player_equipped_gear.gem_wow_item_ids is
  'One entry per socket the item has, in order: the gem''s Blizzard item id (season_gems.wow_item_id), or null for an empty socket. Empty array when the item has no sockets. Synced by blizzard-gear-sync (#1634).';
comment on column public.player_equipped_gear.embellished is
  'The item carries an embellishment (its equip limit is "Embellished"). Synced by blizzard-gear-sync (#1634).';
comment on column public.player_equipped_gear.crafted is
  'The item was crafted. Synced by blizzard-gear-sync (#1634).';
comment on column public.player_equipped_gear.upgrade_rank is
  'The item''s step on its track (the 4 of Hero 4/6), from its track bonus id in track_bonus_ids. Null when none matched. Synced by blizzard-gear-sync (#1634).';
comment on column public.player_equipped_gear.upgrade_max is
  'The top step of the item''s track that season (the 6 of Hero 4/6): the end of the track''s unbroken steps from 1, so the Mythic bosses'' special drop reads 9 of 6, as in game. Null exactly when upgrade_rank is. Synced by blizzard-gear-sync (#1634).';
