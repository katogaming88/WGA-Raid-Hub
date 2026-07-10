-- RCLootCouncil priority export string, migrated off the Apps Script
-- spreadsheet-menu-dependent flow (#335, Phase 5).
--
-- gs/Export.gs's exportPriorityData() (a Sheets custom menu item, not
-- reachable once Sheets is retired) built { players, priority }, base64
-- encoded it, and cached it in the Export sheet's A11 cell; the webapp's
-- getExportString action just read that cache. This function computes the
-- same payload live from Supabase data instead -- no menu step, no cache.
--
-- players: unchanged shape, { [name_realm]: { [slotKey]: { bis: [wow_item_id, ...] } } }.
-- name_realm is used directly (no stripNickname() needed -- nickname already
-- lives in players.nickname, never appended to the name string, per the
-- issue's scope notes). slotKey is derived from bis_items.slot (the BiS
-- Manager's 16-slot grid, #320) when set, falling back to items.slot for
-- legacy rows written before that column existed -- ambiguous only for
-- Finger/Trinket, which default to the first numbered row (ring1/trinket1),
-- same known limitation documented in the slot_override migration. Rows on
-- a placeholder item (M+/Crafted/Catalyst, no wow_item_id) are excluded --
-- RCLootCouncil needs a real item id to award against.
--
-- priority: a genuinely new shape, { [wow_item_id]: { H: [name_realm, ...], M: [name_realm, ...] } },
-- keyed by track instead of GAS's single flat per-item list. The old sheet
-- never distinguished Heroic/Mythic priority at all, but priority_order does
-- (#220) -- collapsing both into one list would let a Mythic-only-ranked
-- player surface during a Heroic award and vice versa. The RCLootCouncil
-- addon side (RCLootCouncil_PriorityLoot, a separate repo) reads the raid's
-- live difficulty via GetInstanceInfo() at vote/award time and looks up
-- priority[itemID][H|M] accordingly -- see that repo's own changelog.
--
-- SECURITY INVOKER: RLS already grants officers/team leaders read access to
-- every table touched (bis_items, priority_order, players, items), same
-- reasoning as generate_priority_order() (#220).

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
        -- Legacy rows (no bis_items.slot) with an ambiguous catalog slot --
        -- default to the first numbered row rather than dropping the entry.
        when 'Finger' then 'ring1'
        when 'Trinket' then 'trinket1'
        when 'Two-Hand' then 'mh2h'
        when 'One-Hand' then 'mh2h'
        when 'Ranged' then 'mh2h'
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
