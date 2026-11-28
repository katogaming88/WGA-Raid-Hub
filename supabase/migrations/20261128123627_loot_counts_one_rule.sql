-- #1585: Disenchant, Bonus Loot, Personal Loot, Xmog and Pet stop counting
-- as loot received in Suggest order and the three loot reports, for a team
-- that never saved a response list.
--
-- #1561 made Suggest order follow a team's saved button list
-- (loot_response_counts_as()), but with no list saved, which is every team
-- today, the database kept its older rule: anything but an OS or M+ roll
-- counts. So 33 disenchanted items counted as Katorri already having them,
-- and a bonus roll reset a raider's raid nights since their last item. The
-- new app already reads with today's rule (todaysCountsAs() in
-- app/src/settings/lootResponses.ts), so the database pages disagreed with
-- the app's own.
--
-- One rule everywhere (Kat, 2026-11-22, on #1585): loot_award_counts_as()
-- is the team's saved list when there is one, otherwise today's rule, the
-- same as todaysCountsAs(): Xmog and Pet are hidden; Bonus Loot, Personal
-- Loot and Disenchant were not handed out; an OS or M+ roll is off spec;
-- anything else, and an award with no response (older imports), is main.
--
-- - generate_priority_order() counts main only, as it did with a list.
-- - rnlsi, season_loot_pace and bis_demand_vs_awards count main and off:
--   the same rows the new app shows (shownLoot()), so off-spec wins still
--   count there as before, and only the five responses above drop out.
-- - loot_response_counts_as() and the RCLootCouncil export
--   (build_rclc_export()) are unchanged.
--
-- No table or stored data changes. The views are recreated from their
-- current definitions with only the filter added, and generate_priority_order()
-- is copied whole from supabase/definitions with only its recip filter changed.

create function public.loot_award_counts_as(p_team_id integer, p_response text)
returns text
language sql
stable
set search_path = public
as $$
  -- Keep in step with todaysCountsAs() and awardCountsAs() in
  -- app/src/settings/lootResponses.ts.
  select coalesce(
    public.loot_response_counts_as(p_team_id, p_response),
    case
      when p_response is null or btrim(p_response) = '' then 'main'
      when lower(btrim(p_response)) in ('xmog', 'pet') then 'hidden'
      when lower(btrim(p_response)) in ('bonus loot', 'personal loot - non tradeable', 'disenchant') then 'none'
      when p_response ~* '\mos\M' or p_response ~* 'm\+' then 'off'
      else 'main'
    end
  )
$$;

comment on function public.loot_award_counts_as(integer, text) is
  'What one award counts as for its team (#1585): main, off, none or hidden. The team''s saved response list when it has one (loot_response_counts_as(), #1561), otherwise today''s rule: Xmog and Pet hidden; Bonus Loot, Personal Loot and Disenchant none; an OS or M+ roll off; anything else, or no response, main. The same rule as todaysCountsAs() in the new app. Read by generate_priority_order() (main only) and the rnlsi, season_loot_pace and bis_demand_vs_awards views (main and off).';

-- The views grant anon SELECT and run as their caller, so both functions are
-- open to anon. They read only team_settings, which is public read.
revoke all on function public.loot_award_counts_as(integer, text) from public;
grant execute on function public.loot_award_counts_as(integer, text) to anon, authenticated, service_role;
grant execute on function public.loot_response_counts_as(integer, text) to anon;

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
  if not (public.has_team_permission(p_team_id, 'view_loot') or public.is_site_admin()) then
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
        -- A Main spec award under the team's button list (#1561), or with no
        -- list saved under today's rule, which also leaves out Disenchant,
        -- Bonus Loot, Personal Loot, Xmog and Pet (#1585).
        and public.loot_award_counts_as(p_team_id, response) = 'main'
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
        and peg.wow_item_id in (select item_id from equipped_item_ids where item_id is not null)
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
      -- trial, 3 = bench (2 was rotator, retired by #1352). Bench wins when
      -- both flags are somehow set.
      case when is_bench then 3 when is_trial then 1 else 0 end as status_tier,
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

-- The three loot reports count the awards loot_award_counts_as() calls main
-- or off. The rule is asked once per team and response (a few dozen pairs),
-- not once per award: a function that pins search_path is never inlined, and
-- asking it per award took Loot pace from about 4 ms to 380 ms on prod data.
-- MATERIALIZED keeps the planner from pushing the rule back down to the
-- award rows.

create or replace view public.rnlsi with (security_invoker=on) as
 WITH responses AS MATERIALIZED (
         SELECT DISTINCT rclc_loot.team_id, rclc_loot.response
           FROM rclc_loot
        ), counted AS MATERIALIZED (
         SELECT responses.team_id, responses.response
           FROM responses
          WHERE loot_award_counts_as(responses.team_id, responses.response) = ANY (ARRAY['main'::text, 'off'::text])
        )
 SELECT p.id AS player_id,
    p.team_id,
    p.name_realm,
    cs.role,
    la.last_award_at,
    ( SELECT count(DISTINCT a.raid_date) AS count
           FROM attendance a
          WHERE a.team_id = p.team_id AND (la.last_award_at IS NULL OR a.raid_date > la.last_award_at::date)) AS raid_nights_since_last_item
   FROM players p
     LEFT JOIN classes_specs cs ON cs.id = p.class_spec_id
     LEFT JOIN LATERAL ( SELECT max(rl.awarded_at) AS last_award_at
           FROM rclc_loot rl
          WHERE rl.player_id = p.id AND (EXISTS ( SELECT 1
                   FROM counted c
                  WHERE c.team_id = rl.team_id AND NOT c.response IS DISTINCT FROM rl.response))) la ON true
  WHERE p.archived_at IS NULL
  ORDER BY p.team_id, cs.role, (( SELECT count(DISTINCT a.raid_date) AS count
           FROM attendance a
          WHERE a.team_id = p.team_id AND (la.last_award_at IS NULL OR a.raid_date > la.last_award_at::date))) DESC;

create or replace view public.season_loot_pace with (security_invoker=on) as
 WITH responses AS MATERIALIZED (
         SELECT DISTINCT rclc_loot.team_id, rclc_loot.response
           FROM rclc_loot
        ), counted AS MATERIALIZED (
         SELECT responses.team_id, responses.response
           FROM responses
          WHERE loot_award_counts_as(responses.team_id, responses.response) = ANY (ARRAY['main'::text, 'off'::text])
        ), awards AS (
         SELECT rl_1.team_id, rl_1.season, rl_1.awarded_at, rl_1.track, rl_1.item_id
           FROM rclc_loot rl_1
             JOIN counted c ON c.team_id = rl_1.team_id AND NOT c.response IS DISTINCT FROM rl_1.response
        ), season_bounds AS (
         SELECT awards.team_id,
            awards.season,
            min(awards.awarded_at) AS season_start
           FROM awards
          GROUP BY awards.team_id, awards.season
        )
 SELECT rl.team_id,
    rl.season,
    floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1 AS season_week,
    rl.track,
    i.slot,
    count(*) AS items_awarded
   FROM awards rl
     JOIN season_bounds sb ON sb.team_id = rl.team_id AND sb.season = rl.season
     LEFT JOIN items i ON i.id = rl.item_id
  GROUP BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1), rl.track, i.slot
  ORDER BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1);

create or replace view public.bis_demand_vs_awards with (security_invoker=on) as
 WITH responses AS MATERIALIZED (
         SELECT DISTINCT rclc_loot.team_id, rclc_loot.response
           FROM rclc_loot
        ), counted AS MATERIALIZED (
         SELECT responses.team_id, responses.response
           FROM responses
          WHERE loot_award_counts_as(responses.team_id, responses.response) = ANY (ARRAY['main'::text, 'off'::text])
        ), demand AS (
         SELECT p.team_id,
            ip.item_id,
            ip.season,
            count(DISTINCT ip.player_id) AS demand_count
           FROM item_preferences ip
             JOIN players p ON p.id = ip.player_id
             JOIN items i_1 ON i_1.id = ip.item_id
          WHERE p.archived_at IS NULL AND ip.status = 'bis'::text AND ip.season IS NOT NULL AND NOT i_1.is_placeholder AND i_1.source = 'raid'::text
          GROUP BY p.team_id, ip.item_id, ip.season
        ), awards AS (
         SELECT rclc_loot.team_id,
            rclc_loot.item_id,
            rclc_loot.season,
            count(*) AS awarded_count
           FROM rclc_loot
             JOIN counted c ON c.team_id = rclc_loot.team_id AND NOT c.response IS DISTINCT FROM rclc_loot.response
          WHERE rclc_loot.item_id IS NOT NULL
          GROUP BY rclc_loot.team_id, rclc_loot.item_id, rclc_loot.season
        )
 SELECT d.team_id,
    d.item_id,
    i.name AS item_name,
    i.slot,
    d.demand_count,
    d.season,
    COALESCE(a.awarded_count, 0::bigint) AS awarded_count
   FROM demand d
     JOIN items i ON i.id = d.item_id
     LEFT JOIN awards a ON a.team_id = d.team_id AND a.item_id = d.item_id AND a.season = d.season
  ORDER BY d.team_id, d.demand_count DESC, (COALESCE(a.awarded_count, 0::bigint));
