-- Normalize the item catalog's slot vocabulary, and de-duplicate it (#453).
--
-- items.slot carried a hand-typed vocabulary from the retired GAS "Item Lookup"
-- spreadsheet ('Boots', 'Gloves', 'Belt', 'Bracers', 'Cloak', 'Shoulders',
-- 'Ring', '1H/2H', 'OH', 'Unknown'). That is not what the game, Wowhead, or
-- scripts/fetch-items.js call these slots -- all three say 'Feet', 'Hands',
-- 'Waist', 'Wrist', 'Back', 'Shoulder', 'Finger', and split weapons into
-- 'One-Hand'/'Two-Hand'/'Ranged'. bis_items.slot already used the correct
-- names, so the catalog was the only thing out of step, and every consumer had
-- to keep a synonym table to bridge the two (getSlotColor, and the CASE in
-- build_rclc_export).
--
-- Every slot below was re-derived from Wowhead by wow_item_id via the &xml
-- endpoint (<inventorySlot>), not translated from the old words -- a string
-- mapping cannot split '1H/2H' into One-Hand (12 items) / Two-Hand (5) /
-- Ranged (2), and cannot recover 'Unknown' at all.
--
-- Tier tokens have no inventory slot on Wowhead (they trade for a set piece
-- rather than being equipped), so those keep the slot they were filed under,
-- normalized to the same vocabulary. 'Curio' likewise stays as-is: the one
-- Curio is a class-set trade token ("Find Kirana ... to trade this for powerful
-- class set armor"), genuinely not equippable and matching no BiS row.

-- 1. Remove duplicate catalog rows.
--
-- The catalog held 132 rows for 113 distinct wow_item_ids: every tier token
-- existed twice, once hand-filed with a slot and once seeded bare with
-- slot = 'Unknown'. They evaded the unique(lower(name)) index because the
-- hand-filed rows carry an armor-type suffix ("Alnforged Riftbloom (Plate)")
-- and the seeded ones do not ("Alnforged Riftbloom"). Nothing references the
-- duplicates -- no bis_items, rclc_loot, priority_order, self_received_requests
-- or item_bosses row points at one -- so they are deleted rather than merged.
-- The guard below refuses to proceed if that is ever untrue.
do $$
declare
  v_refs integer;
begin
  create temporary table _dupe_items on commit drop as
  select id from public.items
  where slot = 'Unknown'
    and wow_item_id in (
      select wow_item_id from public.items
      where wow_item_id is not null
      group by wow_item_id having count(*) > 1
    );

  select
      (select count(*) from public.bis_items              where item_id      in (select id from _dupe_items))
    + (select count(*) from public.rclc_loot              where item_id      in (select id from _dupe_items))
    + (select count(*) from public.priority_order         where item_id      in (select id from _dupe_items))
    + (select count(*) from public.self_received_requests where self_item_id  in (select id from _dupe_items))
    + (select count(*) from public.item_bosses            where item_id      in (select id from _dupe_items))
  into v_refs;

  if v_refs > 0 then
    raise exception 'Refusing to delete duplicate items: % row(s) still reference them', v_refs;
  end if;

  delete from public.items where id in (select id from _dupe_items);
end $$;

-- 2. Stop it happening again. wow_item_id had no unique constraint, which is
-- how one real item became two catalog rows. Partial, since the placeholder
-- rows (M+/Crafted/Catalyst) legitimately have no wow_item_id.
create unique index if not exists items_wow_item_id_key
  on public.items (wow_item_id)
  where wow_item_id is not null;

-- 3. Re-point every remaining slot at the canonical Wowhead value.
update public.items i
   set slot = v.slot
  from (values
  (249278, 'Two-Hand'),
  (260408, 'One-Hand'),
  (249284, 'One-Hand'),
  (249283, 'One-Hand'),
  (249296, 'Two-Hand'),
  (249286, 'Two-Hand'),
  (249277, 'Two-Hand'),
  (249302, 'Two-Hand'),
  (249925, 'One-Hand'),
  (249279, 'Ranged'),
  (249293, 'One-Hand'),
  (249280, 'One-Hand'),
  (249294, 'One-Hand'),
  (249295, 'One-Hand'),
  (260423, 'One-Hand'),
  (249298, 'One-Hand'),
  (249288, 'Ranged'),
  (249281, 'One-Hand'),
  (249287, 'One-Hand'),
  (249922, 'Held In Off-hand'),
  (249921, 'Off Hand'),
  (249275, 'Off Hand'),
  (249276, 'Held In Off-hand'),
  (249328, 'Shoulder'),
  (249313, 'Shoulder'),
  (249318, 'Shoulder'),
  (249333, 'Shoulder'),
  (249364, 'Shoulder'),
  (249366, 'Shoulder'),
  (249363, 'Shoulder'),
  (249365, 'Shoulder'),
  (249307, 'Hands'),
  (249321, 'Hands'),
  (249325, 'Hands'),
  (249330, 'Hands'),
  (249352, 'Hands'),
  (249354, 'Hands'),
  (249351, 'Hands'),
  (249353, 'Hands'),
  (249381, 'Feet'),
  (249920, 'Finger'),
  (249919, 'Finger'),
  (249336, 'Finger'),
  (249369, 'Finger'),
  (249374, 'Waist'),
  (249371, 'Waist'),
  (249376, 'Waist'),
  (249380, 'Waist'),
  (249319, 'Waist'),
  (249314, 'Waist'),
  (249331, 'Waist'),
  (249303, 'Waist'),
  (249373, 'Feet'),
  (249377, 'Feet'),
  (249305, 'Feet'),
  (249332, 'Feet'),
  (249320, 'Feet'),
  (249334, 'Feet'),
  (249382, 'Feet'),
  (249370, 'Back'),
  (249335, 'Back'),
  (249304, 'Wrist'),
  (249327, 'Wrist'),
  (249315, 'Wrist'),
  (249326, 'Wrist')
  ) as v(wow_item_id, slot)
 where i.wow_item_id = v.wow_item_id
   and i.slot is distinct from v.slot;

-- 4. Drop the armor type back out of tier-token names.
--
-- The hand-filed token rows spell the armor type twice: once in
-- items.armor_type, and again as a suffix on the name ("Alnforged Riftbloom
-- (Plate)", armor_type = 'Plate'). The suffix was how the spreadsheet told four
-- otherwise identically-named tokens apart; the column does that job now, and
-- the bare name is what Wowhead and the game call the item.
--
-- This has to run after the delete above: the bare names were exactly what the
-- duplicate rows were occupying, so until they are gone this would collide with
-- the unique(lower(name)) index.
--
-- Only strips a suffix that literally repeats armor_type, so it cannot eat a
-- parenthetical that means something else. The one such case is the class-set
-- trade token "Chiming Void Curio (Tier)", which has no armor_type -- '(Tier)'
-- duplicates no column, so it is left alone.
update public.items
   set name = regexp_replace(name, '\s*\(' || armor_type || '\)\s*$', '')
 where armor_type is not null
   and armor_type <> ''
   and name ~ ('\s*\(' || armor_type || '\)\s*$');

-- 5. Teach the RCLootCouncil export the one new catalog value.
--
-- build_rclc_export (#335) keys off coalesce(bis_items.slot, items.slot), so it
-- sees catalog values whenever a BiS row has no slot of its own. Its CASE
-- already covered the canonical names for the ambiguous ones (Finger, Trinket,
-- One-Hand, Two-Hand, Ranged) but had no arm for the legacy words -- those fell
-- through to null and were dropped from the export. Nothing hit that in
-- practice (every slotless BiS row happened to point at a 'Trinket'), but the
-- normalization above removes the possibility entirely.
--
-- It does introduce one value the CASE has never seen: 'Held In Off-hand',
-- Wowhead's name for off-hand-only items (tomes, orbs). Those share the addon's
-- 'oh' key with shields. Body is otherwise unchanged from #335.
create or replace function public.build_rclc_export(
  p_team_id integer,
  p_season text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_players jsonb;
  v_priority jsonb;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  with bis as (
    select
      p.name_realm,
      i.wow_item_id,
      bi.id,
      case coalesce(bi.slot, i.slot)
        -- BIS_SLOTS row labels (an officer-assigned position).
        when 'Head' then 'helm'
        when 'Neck' then 'neck'
        when 'Shoulder' then 'shoulders'
        when 'Back' then 'cloak'
        when 'Chest' then 'chest'
        when 'Wrist' then 'bracers'
        when 'Hands' then 'gloves'
        when 'Waist' then 'belt'
        when 'Legs' then 'legs'
        when 'Feet' then 'boots'
        when 'Finger 1' then 'ring1'
        when 'Finger 2' then 'ring2'
        when 'Trinket 1' then 'trinket1'
        when 'Trinket 2' then 'trinket2'
        when 'Weapon' then 'mh2h'
        when 'Off Hand' then 'oh'
        -- Catalog slots (an item type), reached when a BiS row has no slot of
        -- its own. A type cannot say which of a paired position it fills, so
        -- default to the first rather than dropping the entry.
        when 'Finger' then 'ring1'
        when 'Trinket' then 'trinket1'
        when 'Two-Hand' then 'mh2h'
        when 'One-Hand' then 'mh2h'
        when 'Ranged' then 'mh2h'
        when 'Held In Off-hand' then 'oh'
        -- 'Curio' deliberately has no arm: a class-set trade token names no
        -- gear position, so it is not exportable as a BiS slot.
        else null
      end as slot_key
    from public.bis_items bi
    join public.players p on p.id = bi.player_id
    join public.items i on i.id = bi.item_id
    where p.team_id = p_team_id
      and p.archived_at is null
      and not i.is_placeholder
      and i.wow_item_id is not null
  ),
  bis_by_slot as (
    select name_realm, slot_key, jsonb_agg(wow_item_id order by id) as item_ids
    from bis
    where slot_key is not null
    group by name_realm, slot_key
  ),
  players_agg as (
    select name_realm, jsonb_object_agg(slot_key, jsonb_build_object('bis', item_ids)) as slots
    from bis_by_slot
    group by name_realm
  ),
  prio as (
    select
      i.wow_item_id,
      po.track,
      p.name_realm,
      po.rank
    from public.priority_order po
    join public.items i on i.id = po.item_id
    join public.players p on p.id = po.player_id
    where po.team_id = p_team_id
      and po.season = p_season
  ),
  prio_by_track as (
    select
      wow_item_id,
      case track when 'Hero' then 'H' when 'Myth' then 'M' end as track_key,
      jsonb_agg(name_realm order by rank) as names
    from prio
    group by wow_item_id, track
  ),
  prio_agg as (
    select wow_item_id, jsonb_object_agg(track_key, names) as tracks
    from prio_by_track
    group by wow_item_id
  )
  select
    coalesce((select jsonb_object_agg(name_realm, slots) from players_agg), '{}'::jsonb),
    coalesce((select jsonb_object_agg(wow_item_id::text, tracks) from prio_agg), '{}'::jsonb)
  into v_players, v_priority;

  return jsonb_build_object('players', v_players, 'priority', v_priority);
end;
$$;

revoke all on function public.build_rclc_export(integer, text) from public;
revoke execute on function public.build_rclc_export(integer, text) from anon;
grant execute on function public.build_rclc_export(integer, text) to authenticated;
