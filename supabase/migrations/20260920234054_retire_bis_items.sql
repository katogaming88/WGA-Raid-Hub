-- #935: bis_items is gone; the wishlist is the only BiS source.
--
-- bis_items was the Sheet-era BiS grid: one row per player per slot, picked
-- by an officer, with an obtained flag. The wishlist (item_preferences, in
-- use since 2026-08-07) is where raiders keep their BiS now, and on
-- 2026-09-05 the table was retired rather than kept empty (decided on #935,
-- with #1032 and #1033). Production holds four rows, all on three players
-- archived in July; every active-roster row went with Phoenix's archive on
-- 2026-08-06.
--
-- The site stopped reading and writing the table in PR #1274 (v3.146.0), one
-- deploy ahead of this file: since #1083 a merge pushes its migration before
-- it publishes the site, so dropping the table in the same PR would have
-- handed every browser still on the old bundle a failed read.
--
-- This drops the table with its two triggers, four policies, index, sequence
-- and three foreign keys; the self-received approval trigger and its
-- function, which only ever ticked a bis_items row; the trigger function that
-- restricted updates to obtained; and the bis_items branches of the three
-- functions that read the table. The self-received sync stops rather than
-- moving to item_preferences: that table has no obtained column, and
-- rclc_loot and bis_demand_vs_awards already answer whether a want was
-- awarded. seasonHistory entries already written keep the BiS snapshot they
-- carry; new archives write none.

drop trigger trg_self_received_sync_bis_obtained on public.self_received_requests;
drop function public.sync_bis_obtained_from_self_received();

drop table public.bis_items;

drop function public.restrict_bis_items_update_to_obtained();

-- generate_priority_order(): the wishlist is the only candidate source. The
-- bis CTE, its half of the candidate union and the has_bis_pick tier go;
-- every candidate now has a wishlist status, so the null-status branches of
-- wishlist_rank cannot fire and are gone with it.
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
    group by ip.player_id
  ),
  candidates as (
    select player_id from wishlist where status <> 'pass'
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

-- archive_current_season(): no BiS snapshot and no wipe. The history entry
-- keeps its other keys; entries already written keep the bis key they carry.
CREATE OR REPLACE FUNCTION public.archive_current_season(p_team_id integer, p_roster_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_entry jsonb;
  v_raids_enriched jsonb;
begin
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;
  if coalesce(v_config->>'seasonName', '') = '' then
    raise exception 'No active season to archive';
  end if;

  -- Rebuilds raidProgression's raid array, folding each boss's current
  -- team_raid_progress row (mythic_pulls, mythic_best_pct) into its object.
  -- `with ordinality` on both levels preserves the original raid/boss array
  -- order -- jsonb_agg has no inherent ordering of its own otherwise.
  select coalesce(
    jsonb_agg(
      raid_obj || jsonb_build_object(
        'bosses', (
          select coalesce(
            jsonb_agg(
              boss_obj || jsonb_build_object(
                'mythicPulls', trp.mythic_pulls,
                'mythicBestPct', trp.mythic_best_pct
              )
              order by boss_ord
            ),
            '[]'::jsonb
          )
          from jsonb_array_elements(raid_obj->'bosses') with ordinality as b(boss_obj, boss_ord)
          -- raid_encounters is only unique on (zone_id, wcl_encounter_id), not
          -- wcl_encounter_id alone -- resolved as a LIMIT 1 scalar subquery
          -- (not a join) so a theoretical cross-zone id collision can never
          -- fan this aggregation out into duplicate boss rows.
          left join public.team_raid_progress trp
            on trp.team_id = p_team_id
            and trp.encounter_id = (
              select re.id
              from public.raid_encounters re
              join public.raid_zones rz on rz.id = re.zone_id
              where rz.wcl_zone_id = (raid_obj->>'wclZoneId')::integer
                and re.wcl_encounter_id = (boss_obj->>'wclEncounterId')::integer
              limit 1
            )
        )
      )
      order by raid_ord
    ),
    '[]'::jsonb
  )
  into v_raids_enriched
  from jsonb_array_elements(coalesce(v_config->'raidProgression', '[]'::jsonb)) with ordinality as r(raid_obj, raid_ord);

  v_entry := jsonb_build_object(
    'name', coalesce(v_config->'seasonName', '""'::jsonb),
    'start', coalesce(v_config->'seasonStart', '""'::jsonb),
    'end', coalesce(v_config->'seasonEnd', '""'::jsonb),
    'raids', v_raids_enriched,
    'roster', coalesce(p_roster_snapshot, '[]'::jsonb)
  );

  update public.team_settings
  set config = config || jsonb_build_object(
    'seasonName', '""'::jsonb,
    'seasonStart', '""'::jsonb,
    'seasonEnd', '""'::jsonb,
    'raidProgression', '[]'::jsonb,
    'seasonHistory', coalesce(v_config->'seasonHistory', '[]'::jsonb) || jsonb_build_array(v_entry)
  )
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  update public.players
  set m_plus_excluded = false, m_plus_note = null
  where team_id = p_team_id
    and archived_at is null
    and m_plus_excluded = true;

  update public.players
  set is_bench = false
  where team_id = p_team_id
    and archived_at is null
    and is_bench = true;

  -- A new tier's loot table invalidates whatever the link was pointing at.
  update public.players
  set bis_link = null
  where team_id = p_team_id
    and archived_at is null
    and bis_link is not null;

  return v_config;
end;
$function$;

-- wishlist_setup_status(): the raider's own tags are the only coverage. The
-- officer-bucket passes go, and with them the locals that fed nothing else.
CREATE OR REPLACE FUNCTION public.wishlist_setup_status(p_team_id integer)
 RETURNS TABLE(player_id integer, name_realm text, discord_id text, wishlist_count integer, bis_link text, missing_bis_rows text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  wishlist_slots text[] := array[
    'Head','Neck','Shoulder','Back','Chest','Wrist','Hands','Waist','Legs','Feet',
    'Finger 1','Finger 2','Trinket 1','Trinket 2','Weapon','Off Hand'
  ];
  prec record;
  bi record;
  candidates text[];
  bis_rows text[];
  off_hand_required boolean;
  required_rows text[];
  missing text[];
begin
  for prec in
    select p.id, p.name_realm, p.bis_link, pe.discord_id,
      (select count(*) from item_preferences ip where ip.player_id = p.id) as wishlist_count
    from players p
    join team_members tm on tm.id = p.team_member_id
    join people pe on pe.id = tm.person_id
    where p.team_id = p_team_id
      and p.archived_at is null
  loop
    -- Raider's tags: wishlistCompleteness()'s bisRows/offHandRequired pass.
    -- item_preferences.slot is present for Finger/Trinket/Weapon/Off Hand
    -- disambiguation and every placeholder row, null (falls back to catalog
    -- slot) everywhere else.
    bis_rows := array[]::text[];
    off_hand_required := false;

    for bi in
      select ip.status, ip.slot as explicit_slot, i.slot as catalog_slot
      from item_preferences ip
      join items i on i.id = ip.item_id
      where ip.player_id = prec.id
    loop
      if bi.explicit_slot is not null then
        candidates := array[bi.explicit_slot];
      else
        candidates := case bi.catalog_slot
          when 'Finger' then array['Finger 1', 'Finger 2']
          when 'Trinket' then array['Trinket 1', 'Trinket 2']
          when 'One-Hand' then array['Weapon']
          when 'Two-Hand' then array['Weapon']
          when 'Ranged' then array['Weapon']
          when 'Off Hand' then array['Off Hand']
          when 'Held In Off-hand' then array['Off Hand']
          when 'Head' then array['Head']
          when 'Neck' then array['Neck']
          when 'Shoulder' then array['Shoulder']
          when 'Back' then array['Back']
          when 'Chest' then array['Chest']
          when 'Wrist' then array['Wrist']
          when 'Hands' then array['Hands']
          when 'Waist' then array['Waist']
          when 'Legs' then array['Legs']
          when 'Feet' then array['Feet']
          else array[]::text[]
        end;
      end if;

      if bi.status = 'bis' then
        bis_rows := bis_rows || candidates;
        if (bi.explicit_slot = 'Weapon' or bi.explicit_slot is null) and bi.catalog_slot = 'One-Hand' then
          off_hand_required := true;
        end if;
      end if;
    end loop;

    required_rows := array(
      select s from unnest(wishlist_slots) s where s <> 'Off Hand' or off_hand_required
    );
    missing := array(
      select r from unnest(required_rows) r
      where not (bis_rows @> array[r])
    );

    player_id := prec.id;
    name_realm := prec.name_realm;
    discord_id := prec.discord_id;
    wishlist_count := prec.wishlist_count;
    bis_link := prec.bis_link;
    missing_bis_rows := missing;
    return next;
  end loop;
end;
$function$;
