-- generate_priority_order()'s recip CTE has only ever recognized a
-- loot-council award (rclc_loot) or a logged self-received report
-- (self_received_requests) as "already has this item." A raider who
-- received the exact item outside either of those paths -- most commonly a
-- self-received drop nobody remembered to log through the app's "Mark
-- received" flow -- still shows up as a candidate and can keep getting
-- ranked for an item already sitting in their bags/equipped, confirmed live
-- (Soulcialist had Gebbo's Bottomless Bag equipped on Myth with no
-- self-received record for it).
--
-- player_equipped_gear already syncs every roster player's actual item_id
-- per slot from the Blizzard API, so this adds it as a third source into
-- recip, alongside rclc_loot and self_received_requests -- same
-- has_myth/has_hero/has_champ shape, derived from player_equipped_gear.track
-- (the same ilvl-threshold-derived label the existing equipped-slot-ilvl
-- multiplier already reads). This is an exact item_id match, independent of
-- and additive to that existing slot-level ilvl multiplier below (which only
-- compares ilvl-vs-threshold, never item_id) -- a player can trip both, one,
-- or neither.
--
-- Tier tokens (tier_token_map) drop and are wishlisted under the generic
-- token's item_id, but a raider's equipped copy is the resolved,
-- class-specific item -- p_item_id itself never appears equipped for those.
-- Resolving through tier_token_map (token_item_id -> resolved_item_id) is
-- required here or every tier-token equipped item would silently fail to
-- match; only checked in the token-to-resolved direction since the
-- wishlist/loot side is always keyed to the token, never the resolved item
-- (tier_token_map's own header comment).
--
-- If a team hasn't configured team_settings.config.trackIlvlThresholds (or
-- an equipped item's level clears none of the floors), the synced row's
-- `track` comes back null and this contributes no exclusion for that
-- player/item -- same "no thresholds configured yet, no-op rather than a
-- guess" behavior the existing equipped-slot-ilvl factor already accepts.
--
-- Everything else is unchanged from 20260907153921's version (rotator
-- tiering, tier_rank, wishlist_rank, equipped-slot multipliers,
-- existing_priority, self-received requests) -- see that migration and
-- 20260902002242 before it for the rest of the function's history.
create or replace function public.generate_priority_order(
  p_team_id integer,
  p_season text,
  p_item_id integer,
  p_track text
)
returns table (
  player_id integer,
  name_realm text,
  role text,
  weighted_total numeric,
  status_label text,
  wishlist_status text
)
language plpgsql
security invoker
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  v_item_slot text;
  v_equipment_slots text[];
  v_hero_floor integer;
  v_myth_floor integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  select i.slot into v_item_slot from public.items i where i.id = p_item_id;

  v_equipment_slots := case v_item_slot
    when 'Head' then array['HEAD']
    when 'Neck' then array['NECK']
    when 'Shoulder' then array['SHOULDER']
    when 'Back' then array['BACK']
    when 'Chest' then array['CHEST']
    when 'Wrist' then array['WRIST']
    when 'Hands' then array['HANDS']
    when 'Waist' then array['WAIST']
    when 'Legs' then array['LEGS']
    when 'Feet' then array['FEET']
    when 'Finger' then array['FINGER_1', 'FINGER_2']
    when 'Trinket' then array['TRINKET_1', 'TRINKET_2']
    when 'One-Hand' then array['MAIN_HAND']
    when 'Two-Hand' then array['MAIN_HAND']
    when 'Ranged' then array['MAIN_HAND']
    when 'Off Hand' then array['OFF_HAND']
    else array[]::text[]
  end;

  -- No thresholds configured for this team/season yet -- both floors stay
  -- null, and null >= item_level is never true in the equipped CTE below,
  -- so the whole factor is a no-op rather than a guess.
  select
    (ts.config -> 'trackIlvlThresholds' ->> 'Hero')::integer,
    (ts.config -> 'trackIlvlThresholds' ->> 'Myth')::integer
  into v_hero_floor, v_myth_floor
  from public.team_settings ts
  where ts.team_id = p_team_id;

  return query
  with bis as (
    select distinct bi.player_id
    from public.bis_items bi
    join public.players p on p.id = bi.player_id
    where bi.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
  ),
  wishlist as (
    select
      ip.player_id,
      (array_agg(ip.status order by
        case ip.status
          when 'bis' then 1
          when 'good' then 2
          when 'catalyst' then 3
          when 'ok' then 4
          when 'pass' then 5
        end
      ))[1] as status
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    where ip.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
    group by ip.player_id
  ),
  candidates as (
    (select player_id from bis union select player_id from wishlist where status <> 'pass')
    except
    select player_id from wishlist where status = 'pass'
  ),
  equipped_item_ids as (
    select p_item_id as item_id
    union
    select resolved_item_id from public.tier_token_map where token_item_id = p_item_id
  ),
  recip as (
    select
      player_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero,
      bool_or(track = 'Champion') as has_champ
    from (
      select player_id, track
      from public.rclc_loot
      where team_id = p_team_id
        and item_id = p_item_id
        and season = p_season
        and player_id is not null
        and not coalesce(response ~* '\mos\M', false)
        and not coalesce(response ~* 'm\+', false)
      union all
      select player_id, track
      from public.self_received_requests
      where team_id = p_team_id
        and self_item_id = p_item_id
        and status = 'approved'
        and player_id is not null
      union all
      select peg.player_id, peg.track
      from public.player_equipped_gear peg
      join public.players p on p.id = peg.player_id
      where p.team_id = p_team_id
        and p.archived_at is null
        and peg.item_id in (select item_id from equipped_item_ids)
    ) owned
    group by player_id
  ),
  equipped as (
    select
      peg.player_id,
      bool_or(v_myth_floor is not null and peg.item_level >= v_myth_floor) as slot_meets_myth,
      bool_or(v_hero_floor is not null and peg.item_level >= v_hero_floor) as slot_meets_hero
    from public.player_equipped_gear peg
    where peg.equipment_slot = any (v_equipment_slots)
    group by peg.player_id
  ),
  tier_meta as (
    select exists(
      select 1 from public.tier_token_map where token_item_id = p_item_id
    ) as is_tier_token
  ),
  existing_priority as (
    select
      po.player_id,
      avg(po.rank) as avg_existing_rank
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
      and po.track = p_track
      and po.item_id <> p_item_id
    group by po.player_id
  ),
  base as (
    select
      p.id as player_id,
      p.name_realm,
      cs.role,
      p.is_bench,
      p.is_trial,
      p.is_rotator,
      p.tier_pieces_equipped,
      sc.performance_score,
      sc.attendance_score,
      coalesce(r.has_myth, false) as has_myth,
      coalesce(r.has_hero, false) as has_hero,
      coalesce(r.has_champ, false) as has_champ,
      coalesce(e.slot_meets_myth, false) as slot_meets_myth,
      coalesce(e.slot_meets_hero, false) as slot_meets_hero,
      w.status as wishlist_status,
      exists(select 1 from bis b where b.player_id = p.id) as has_bis_pick,
      tm.is_tier_token,
      ep.avg_existing_rank
    from candidates c
    join public.players p on p.id = c.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
    left join equipped e on e.player_id = p.id
    left join wishlist w on w.player_id = p.id
    left join existing_priority ep on ep.player_id = p.id
    cross join tier_meta tm
    where not coalesce(r.has_myth, false)
      and not (p_track = 'Hero' and coalesce(r.has_hero, false))
  ),
  scored as (
    select
      player_id,
      name_realm,
      role,
      case
        when role in ('Tank', 'Heal') then
          case when attendance_score > 0 then attendance_score else null end
        else
          case
            when performance_score > 0 or attendance_score > 0
              then round((coalesce(performance_score, 0) * 0.5 + coalesce(attendance_score, 0) * 0.5), 1)
            else null
          end
      end as raw_score,
      case role
        when 'Tank' then 0.50
        when 'Heal' then 0.75
        else 1.0
      end as role_mult,
      -- Sort tier only, no longer a score input: 0 = full status, 1 =
      -- trial, 2 = rotator (#924), 3 = bench. Precedence when more than one
      -- flag is somehow set: bench > rotator > trial, matching the old
      -- bench-over-trial precedence this branch already had.
      case when is_bench then 3 when is_rotator then 2 when is_trial then 1 else 0 end as status_tier,
      -- Wishlist status as a hard sort tier, not just a score multiplier --
      -- BiS (or an untagged bis_items pick) always outranks Good, which
      -- always outranks OK/Catalyst (tied), regardless of raw_score. Tier
      -- tokens keep their existing binary split (0 = keeping it, 1 = any
      -- sidegrade tag) since tier_rank is a stronger, more specific signal
      -- there than a 3-way wishlist split would add.
      case
        when is_tier_token then
          case
            when wishlist_status = 'bis' then 0
            when wishlist_status is null and has_bis_pick then 0
            else 1
          end
        when wishlist_status = 'bis' then 0
        when wishlist_status is null and has_bis_pick then 0
        when wishlist_status = 'good' then 1
        when wishlist_status in ('ok', 'catalyst') then 2
        else 0
      end as wishlist_rank,
      case
        when not is_tier_token then 0
        else case coalesce(tier_pieces_equipped, 0)
          when 1 then 1
          when 0 then 2
          when 3 then 3
          when 2 then 4
          when 4 then 5
          else 6
        end
      end as tier_rank,
      avg_existing_rank,
      is_tier_token,
      tier_pieces_equipped,
      is_bench,
      is_trial,
      is_rotator,
      has_myth,
      has_hero,
      has_champ,
      slot_meets_myth,
      slot_meets_hero,
      wishlist_status
    from base
  ),
  multiplied as (
    select
      player_id,
      name_realm,
      role,
      raw_score,
      status_tier,
      wishlist_rank,
      tier_rank,
      avg_existing_rank,
      wishlist_status,
      (role_mult
      -- Item-ownership multipliers stack on top, mythic and heroic branches
      -- are mutually exclusive since p_track is one or the other.
      * case when p_track = 'Myth' and has_hero then 0.85 else 1.0 end
      * case when p_track = 'Myth' and has_champ and not has_hero then 1.07 else 1.0 end
      * case when p_track = 'Myth' and not has_hero and not has_champ then 1.15 else 1.0 end
      * case when p_track = 'Hero' and has_champ then 0.90 else 1.0 end
      -- Equipped-slot track multipliers: a weaker, independent signal from
      -- the same-item ones above -- "already itemized here," not "already
      -- owns this drop."
      * case when p_track = 'Myth' and slot_meets_myth then 0.92 else 1.0 end
      * case when p_track = 'Hero' and slot_meets_hero then 0.92 else 1.0 end
      -- Wishlist multiplier (#515): 'bis'/untagged (bis_items-only) both
      -- stay at 1.0, today's math unchanged. 'pass' never reaches here --
      -- already excluded by the candidates CTE above.
      * case wishlist_status
          when 'bis' then 1.0
          when 'good' then 0.90
          when 'ok' then 0.60
          when 'catalyst' then 0.75
          else 1.0
        end
      ) as final_mult,
      (case
        when is_bench then 'Bench'
        when is_rotator then 'Rotator'
        when is_trial then 'Trial'
        else ''
      end) as base_status,
      case when is_tier_token then 'Tier: ' || coalesce(tier_pieces_equipped, 0) || '/5' end as tier_status_label,
      case when p_track = 'Myth' and has_hero then 'Has Heroic' end as myth_hero_status,
      case when p_track = 'Myth' and has_champ and not has_hero then 'Has Champion' end as myth_champ_status,
      case when p_track = 'Myth' and not has_hero and not has_champ then 'No Version' end as myth_neither_status,
      case when p_track = 'Hero' and has_champ then 'Has Champion' end as hero_champ_status,
      case when p_track = 'Myth' and slot_meets_myth then 'Myth ilvl Equipped (Slot)' end as slot_myth_status,
      case when p_track = 'Hero' and slot_meets_hero then 'Hero ilvl Equipped (Slot)' end as slot_hero_status
    from scored
  )
  select
    player_id,
    name_realm,
    role,
    case when raw_score is not null then round(raw_score * final_mult, 1) end as weighted_total,
    nullif(
      array_to_string(
        array_remove(
          array[
            nullif(base_status, ''),
            tier_status_label,
            myth_hero_status,
            myth_champ_status,
            myth_neither_status,
            hero_champ_status,
            slot_myth_status,
            slot_hero_status
          ],
          null
        ),
        ', '
      ),
      ''
    ) as status_label,
    wishlist_status
  from multiplied
  order by
    status_tier asc,
    wishlist_rank asc,
    tier_rank asc,
    avg_existing_rank desc nulls first,
    coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$$;

-- CREATE OR REPLACE preserves existing grants, but re-apply explicitly to
-- match the same defensive pattern every prior migration touching this
-- function uses (officer/team_leader/site_admin only, via the
-- my_team_role()/is_site_admin() check inside the function body -- never
-- anon or public execute).
revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;
