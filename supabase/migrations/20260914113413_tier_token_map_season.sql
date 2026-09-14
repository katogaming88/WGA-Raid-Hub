-- #1108: tier_token_map carries a season.
--
-- Every row has been implicitly Midnight Season 2's, the only tier ever
-- seeded. When the next tier set ships, its tokens get added next to these,
-- and two things go wrong without a season on each row:
--
--   - The site's tier-piece counter (classTierResolvedItemsBySlot,
--     js/common.js) inverts the map into one resolved item per class per
--     slot. With two seasons' rows it keeps whichever it meets last, so a
--     raider's tier count can be checked against last season's items, and
--     that count feeds generate_priority_order()'s tier weighting.
--   - An archived season's mapping can only be kept by leaving its rows in a
--     table that has no way to say which season they belong to.
--
-- The column holds the season code (MID2), the form priority_order,
-- rclc_loot and scoring already use and the one #932's seasons table keys
-- on, so #932 can add the foreign key without converting anything.
--
-- No default: a seeding script that forgets the season should fail on the
-- insert, not quietly file the new tier under the old one.

alter table public.tier_token_map add column season text;

update public.tier_token_map set season = 'MID2' where season is null;

alter table public.tier_token_map alter column season set not null;

-- The key becomes per season. A resolved item still belongs to exactly one
-- token/class pair: each tier's class pieces are new items, so the global
-- uniqueness on resolved_item_id stays as it is.
drop index public.tier_token_map_token_class_key;

create unique index tier_token_map_season_token_class_key
  on public.tier_token_map (season, token_item_id, class);

comment on column public.tier_token_map.season is
  'Season code (MID2) this token mapping belongs to (#1108). Readers filter on the current season; #932 adds the foreign key to seasons(code).';

-- generate_priority_order(): the two tier_token_map lookups now match the
-- season being generated, from the definition as of 20260913013951. Token
-- item ids are new each tier, so for today's data this changes no result;
-- it keeps a regenerated archived season on its own season's tokens, and
-- makes "is this a tier token" a statement about this season.
CREATE OR REPLACE FUNCTION public.generate_priority_order(p_team_id integer, p_season text, p_item_id integer, p_track text)
 RETURNS TABLE(player_id integer, name_realm text, role text, weighted_total numeric, status_label text, wishlist_status text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_item_slot text;
  v_equipment_slots text[];
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
  -- wow_item_id space, not items.id (20260913004747). Null entries drop out
  -- on their own: an IN-list containing only null matches nothing. The
  -- item_id alias is load-bearing -- see that migration for why an
  -- unaliased column here silently becomes a self-referential tautology.
  equipped_item_ids as (
    select wow_item_id as item_id from public.items where id = p_item_id
    union
    select i.wow_item_id as item_id
    from public.tier_token_map ttm
    join public.items i on i.id = ttm.resolved_item_id
    where ttm.token_item_id = p_item_id
      and ttm.season = p_season
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
        and peg.item_id in (select item_id from equipped_item_ids where item_id is not null)
    ) owned
    group by player_id
  ),
  -- The lowest track worn across this item's equipment slot(s), as a rank
  -- (3 = Myth, 2 = Hero, 1 = anything lower, 0 = nothing worn). min() over
  -- the slots gives rings/trinkets their lower-of-two grading and is a
  -- no-op for the single-slot cases. A slot with no synced row contributes
  -- nothing to min(), so the count check below catches an unfilled half of
  -- a pair and drops the whole thing to the lowest step.
  equipped as (
    select
      peg.player_id,
      case
        when count(*) < coalesce(array_length(v_equipment_slots, 1), 0) then 0
        else min(case peg.track when 'Myth' then 3 when 'Hero' then 2 else 1 end)
      end as slot_track_rank
    from public.player_equipped_gear peg
    where peg.equipment_slot = any (v_equipment_slots)
    group by peg.player_id
  ),
  tier_meta as (
    select exists(
      select 1 from public.tier_token_map
      where token_item_id = p_item_id
        and season = p_season
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
      coalesce(e.slot_track_rank, 0) as slot_track_rank,
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
      slot_track_rank,
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
      -- Equipped-slot track steps: a weaker, independent signal from the
      -- same-item ones above -- "already itemized here," not "already owns
      -- this drop." Applies to both generated tracks alike; the question
      -- (how well is this slot already covered, and can they improve it
      -- themselves) does not change with the track being handed out.
      * case slot_track_rank when 3 then 0.92 when 2 then 0.96 else 1.0 end
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
      -- No longer says "ilvl": the step is the slot's actual gear track now,
      -- not whether an item level cleared a threshold.
      case slot_track_rank
        when 3 then 'Myth Equipped (Slot)'
        when 2 then 'Hero Equipped (Slot)'
      end as slot_track_status
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
            slot_track_status
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
$function$;

