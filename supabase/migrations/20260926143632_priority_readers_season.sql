-- #936: the priority readers answer for one tier, not every tier a raider has
-- ever filed a pick under.
--
-- item_preferences.season has held a tier code since 20260924003956 and the
-- unique key has carried the season since 20260924145125, so a raider holds a
-- separate pick for the same item and slot in each tier. Nothing read the
-- column. Until the key widened, "their rows for this item" could only be one
-- tier, and every officer-side reader was correct by construction; now none of
-- them is, and the errors run in opposite directions:
--
--   generate_priority_order() takes the strongest status across a raider's
--   rows, so a BiS mark left in an earlier tier makes them a candidate for
--   this one, at the top of the order, over a raider who marked the item good
--   for the tier being generated, even when their own row here says pass.
--
--   build_rclc_export() reads the table twice. Its bis CTE is the per-raider
--   BiS list RCLootCouncil receives, so two tiers of picks arrive merged into
--   one slot's list. Its wish CTE is the status shown beside each exported
--   rank, and its comment gave its reason for having no season filter as
--   matching generate_priority_order()'s scope; that reason ends here, so the
--   filter arrives with it. The 2026-09-24 decisions entry left the export's
--   filter to its own issue as a behaviour question, which this answers: the
--   export cannot rank in one tier and label from another.
--
-- Nobody can reach any of this on production today, where every pick an
-- active raider holds is on MID2. A second tier of picks becomes ordinary
-- with the raider season switcher, so this lands before it. A tripwire in
-- tests/rls/item-preferences.test.js kept that order and half of it retires
-- here; wishlist_setup_status() and bis_demand_vs_awards are #1268, and its
-- other half goes with them.
--
-- A pick with no season belongs to no tier, which is the reading the write
-- gate already gives it, so all three reads drop one. On production that is
-- 9 rows on 2 archived characters (2026-09-24), and two of these three reads
-- exclude an archived character anyway.
--
-- The current site's own copies of this aggregate move in the same pull
-- request: fetchTeamItemPreferences() and fetchPlayerItemPreferences() ask
-- for the season the officer is viewing, so the status beside a rank agrees
-- with the order it sits in.

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
  -- The picks filed under the tier being generated, and only those (#936).
  -- A raider holds a separate pick for the same item in each tier since the
  -- unique key carried the season, so the strongest status across every row
  -- would let a BiS mark left in an earlier tier outvote this tier's pass.
  with wishlist as (
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
      and ip.season = p_season
    group by ip.player_id
  ),
  candidates as (
    select player_id from wishlist where status <> 'pass'
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
      -- BiS always outranks Good, which always outranks OK/Catalyst (tied),
      -- regardless of raw_score. Tier tokens keep their existing binary
      -- split (0 = keeping it, 1 = any sidegrade tag) since tier_rank is a
      -- stronger, more specific signal there than a 3-way wishlist split
      -- would add.
      case
        when is_tier_token then
          case
            when wishlist_status = 'bis' then 0
            else 1
          end
        when wishlist_status = 'bis' then 0
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
      -- Wishlist multiplier (#515): 'bis' stays at 1.0. 'pass' never reaches
      -- here -- already excluded by the candidates CTE above.
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

-- CREATE OR REPLACE preserves existing grants; re-applied explicitly to match
-- every prior migration touching this function (officer/team_leader/site_admin
-- only, through the my_team_role()/is_site_admin() check in the body).
revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;

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
      and ip.season = p_season
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
  -- no item_preferences entry behind them at all. Scoped to the tier being
  -- exported (#936), the same scope generate_priority_order() ranks in: a
  -- status from another tier beside a rank generated from this one is a label
  -- the addon would show against a pick the raider did not make here.
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
      and season = p_season
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

revoke all on function public.build_rclc_export(integer, text, text) from public;
revoke execute on function public.build_rclc_export(integer, text, text) from anon;
grant execute on function public.build_rclc_export(integer, text, text) to authenticated;
