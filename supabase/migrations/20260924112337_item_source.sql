-- #1166: each item says where it comes from (raid, dungeon, crafted).
--
-- The catalog held raid loot only, so a raider who wanted an M+ or crafted
-- piece could only wishlist the generic 'M+' or 'Crafted' stand-in. The new
-- app's wishlist offers the real items instead, and they need a marker: they
-- have no raid (wcl_zone_id is null), so nothing else says a dungeon trinket
-- is not council loot.
--
--   source  'raid' (every existing row), 'dungeon' (a season's M+ pool) or
--           'crafted'. Only raid items are ranked or exported to RCLootCouncil.
--   season  the season code a dungeon or crafted item belongs to, the way
--           raid_zones.season places a raid item. Null for raid items, whose
--           season comes from their raid. Required for the other two so last
--           season's dungeon loot does not appear in every later season.
--
-- The RCLootCouncil export and the BiS demand count already skipped the
-- stand-in picks (is_placeholder); they now skip anything not from a raid
-- as well. Both bodies are otherwise unchanged from their last versions
-- (20260924003956 and 20260829235114), grants preserved by create or replace.
-- The stand-in rows and their special cases stay until cutover (#1105).

alter table public.items
  add column source text not null default 'raid',
  add column season text references public.seasons (code),
  add constraint items_source_check check (source in ('raid', 'dungeon', 'crafted')),
  add constraint items_season_by_source check ((source = 'raid') = (season is null));

comment on column public.items.source is
  'Where the item comes from: raid, dungeon (a season''s M+ pool) or crafted. Only raid items are ranked or exported to RCLootCouncil (#1166).';
comment on column public.items.season is
  'Season code for a dungeon or crafted item; null for a raid item, whose season comes from raid_zones (#1166).';

CREATE OR REPLACE FUNCTION public.build_rclc_export(p_team_id integer, p_season text, p_track text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_players jsonb;
  v_priority jsonb;
  v_status_labels jsonb;
  v_track_key text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;
  v_track_key := case p_track when 'Hero' then 'H' when 'Myth' then 'M' end;

  with bis as (
    select
      p.name_realm,
      i.wow_item_id,
      ip.id,
      case coalesce(ip.slot, i.slot)
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
        -- Catalog slots (an item type), reached when a preference row has no
        -- slot of its own. A type cannot say which of a paired position it
        -- fills, so default to the first rather than dropping the entry.
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
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    join public.items i on i.id = ip.item_id
    where p.team_id = p_team_id
      and p.archived_at is null
      and ip.status = 'bis'
      and not i.is_placeholder
      and i.source = 'raid'
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
  -- Same exclusion generate_priority_order() applies at generation time
  -- (#480): a Mythic recipient drops from every track's ranked list for that
  -- item; a Heroic recipient drops from the Heroic list only.
  recip as (
    select
      player_id,
      item_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero
    from public.rclc_loot
    where team_id = p_team_id
      and season = p_season
      and player_id is not null
    group by player_id, item_id
  ),
  -- A rank's own player+item wishlist tier, when one actually exists --
  -- only bis/good/ok are wishlist "wants this" tiers (catalyst and pass
  -- aren't ranking signals in that sense, so left unmatched on purpose).
  -- Not every ranked player has a row here: tier-token matching and other
  -- fallback signals in generate_priority_order() can place a player with
  -- no item_preferences entry behind them at all. No season filter: the
  -- column holds a code since #936, but generate_priority_order() itself
  -- doesn't filter by season either, so item_id + team_id is the correct
  -- scope.
  -- Deduped to one row per player+item -- a dual-wieldable weapon can have
  -- separate Weapon/Off Hand preference rows for the same item_id, and only
  -- the single best-tier status should ever reach the export.
  wish as (
    select
      player_id,
      item_id,
      (array_agg(status order by
        case status
          when 'bis' then 1
          when 'good' then 2
          when 'ok' then 3
        end
      ))[1] as status
    from public.item_preferences
    where team_id = p_team_id
      and status in ('bis', 'good', 'ok')
    group by player_id, item_id
  ),
  prio as (
    select
      i.wow_item_id,
      p.name_realm,
      po.rank,
      w.status as wish_status
    from public.priority_order po
    join public.items i on i.id = po.item_id
    join public.players p on p.id = po.player_id
    left join recip r on r.player_id = po.player_id and r.item_id = po.item_id
    left join wish w on w.player_id = po.player_id and w.item_id = po.item_id
    where po.team_id = p_team_id
      and po.season = p_season
      and po.track = p_track
      and not coalesce(r.has_myth, false)
      and not (po.track = 'Hero' and coalesce(r.has_hero, false))
  ),
  prio_agg as (
    select
      wow_item_id,
      jsonb_build_object(v_track_key, jsonb_agg(name_realm order by rank))
      || jsonb_build_object(
           v_track_key || '_status',
           coalesce(
             jsonb_object_agg(name_realm, wish_status) filter (where wish_status is not null),
             '{}'::jsonb
           )
         ) as tracks
    from prio
    group by wow_item_id
  )
  select
    coalesce((select jsonb_object_agg(name_realm, slots) from players_agg), '{}'::jsonb),
    coalesce((select jsonb_object_agg(wow_item_id::text, tracks) from prio_agg), '{}'::jsonb)
  into v_players, v_priority;

  -- WISHLIST_LABEL_DEFAULTS (js/tabs/tab-admin.js) is the site's own
  -- default for each tier -- mirrored here (bis/good/ok only, the only
  -- tiers this export attaches statuses for) so the export always hands
  -- the addon a complete label set, whether or not the team has overridden
  -- any of them.
  select jsonb_build_object('bis', 'BiS', 'good', '2nd Choice', 'ok', 'Sidegrade')
      || coalesce(
           (select ts.config -> 'wishlistStatusLabels' from public.team_settings ts where ts.team_id = p_team_id),
           '{}'::jsonb
         )
  into v_status_labels;

  return jsonb_build_object('players', v_players, 'priority', v_priority, 'statusLabels', v_status_labels);
end;
$function$;

create or replace view public.bis_demand_vs_awards
with (security_invoker = on)
as
with demand as (
  select p.team_id, ip.item_id, count(distinct ip.player_id) as demand_count
  from public.item_preferences ip
  join public.players p on p.id = ip.player_id
  join public.items i on i.id = ip.item_id
  where p.archived_at is null
    and ip.status = 'bis'
    and not i.is_placeholder
    and i.source = 'raid'
  group by p.team_id, ip.item_id
),
awards as (
  select team_id, item_id, season, count(*) as awarded_count
  from public.rclc_loot
  where item_id is not null
  group by team_id, item_id, season
)
select
  d.team_id,
  d.item_id,
  i.name as item_name,
  i.slot,
  d.demand_count,
  a.season,
  coalesce(a.awarded_count, 0) as awarded_count
from demand d
join public.items i on i.id = d.item_id
left join awards a on a.team_id = d.team_id and a.item_id = d.item_id
order by d.team_id, d.demand_count desc, coalesce(a.awarded_count, 0) asc;
