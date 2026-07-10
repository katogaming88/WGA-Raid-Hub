-- Priority generator (#220, Phase 5).
--
-- Ports gs/wgaWebApp.gs's generatePriorityForItem()/savePriorityOrderForItem()
-- (the web-app implementation the frontend actually calls -- the sheet-menu
-- version in gs/PriorityGenerator.gs lacks the heroic/champion "already has
-- item" penalties and is not the source of truth here).
--
-- The "recent/trend/best blend" the issue flagged as needing to be resolved
-- first turned out not to be a blend at all: it's the live Scoring sheet's
-- Weighted Total column, confirmed from the cell formula to be
-- =IFERROR(Performance*0.5 + Attendance*0.5, ""). Performance itself is
-- officer-curated upstream of this (a manual "commit" workflow, still GAS-only,
-- out of scope here) -- this function just reads scoring.performance_score /
-- scoring.attendance_score as-is, exactly like the sheet does today.
--
-- SECURITY INVOKER, not DEFINER, for both functions: RLS already grants
-- officers full read/write on every table touched here ("Officers write
-- priority_order", "Public read scoring"/"Public read bis_items" etc.), the
-- same reasoning that moved import_rclc_loot() (#219) off DEFINER despite the
-- original issue text predicting DEFINER for this one too. write_audit_log()
-- (#214) remains DEFINER and handles its own authorization regardless.
--
-- Note: the issue text was written before #343's difficulty->track rename;
-- priority_order.track uses 'Hero'/'Myth', not 'Heroic'/'Mythic'.

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
  status_label text
)
language plpgsql
security invoker
set search_path = public
stable
as $$
#variable_conflict use_column
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  return query
  with bis as (
    select distinct bi.player_id
    from public.bis_items bi
    join public.players p on p.id = bi.player_id
    where bi.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
  ),
  recip as (
    select
      player_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero,
      bool_or(track = 'Champion') as has_champ
    from public.rclc_loot
    where team_id = p_team_id
      and item_id = p_item_id
      and season = p_season
      and player_id is not null
    group by player_id
  ),
  base as (
    select
      p.id as player_id,
      p.name_realm,
      cs.role,
      p.is_bench,
      p.is_trial,
      sc.performance_score,
      sc.attendance_score,
      coalesce(r.has_myth, false) as has_myth,
      coalesce(r.has_hero, false) as has_hero,
      coalesce(r.has_champ, false) as has_champ
    from bis b
    join public.players p on p.id = b.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
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
      is_bench,
      is_trial,
      has_myth,
      has_hero,
      has_champ
    from base
  ),
  multiplied as (
    select
      player_id,
      name_realm,
      role,
      raw_score,
      -- Status multiplier: mutually exclusive by branch, matching
      -- generatePriorityForItem's if/else-if chain exactly.
      (case
        when is_bench and role in ('Tank', 'Heal') then role_mult * 0.65
        when is_trial and role in ('Tank', 'Heal') then role_mult * 0.80
        when is_bench then 0.45
        when is_trial then 0.85
        else role_mult
      end
      -- Item-ownership multipliers stack on top, mythic and heroic branches
      -- are mutually exclusive since p_track is one or the other.
      * case when p_track = 'Myth' and has_hero then 0.85 else 1.0 end
      * case when p_track = 'Myth' and has_champ and not has_hero then 1.07 else 1.0 end
      * case when p_track = 'Myth' and not has_hero and not has_champ then 1.15 else 1.0 end
      * case when p_track = 'Hero' and has_champ then 0.90 else 1.0 end
      ) as final_mult,
      (case
        when is_bench then 'Bench'
        when is_trial then 'Trial'
        else ''
      end) as base_status,
      case when p_track = 'Myth' and has_hero then 'Has Heroic' end as myth_hero_status,
      case when p_track = 'Myth' and has_champ and not has_hero then 'Has Champion' end as myth_champ_status,
      case when p_track = 'Myth' and not has_hero and not has_champ then 'No Version' end as myth_neither_status,
      case when p_track = 'Hero' and has_champ then 'Has Champion' end as hero_champ_status
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
            myth_hero_status,
            myth_champ_status,
            myth_neither_status,
            hero_champ_status
          ],
          null
        ),
        ', '
      ),
      ''
    ) as status_label
  from multiplied
  order by coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$$;

revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;


create or replace function public.save_priority_order(
  p_team_id integer,
  p_season text,
  p_item_id integer,
  p_track text,
  p_player_ids jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_name text;
  v_count integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and item_id = p_item_id
     and track = p_track;

  insert into public.priority_order (team_id, season, item_id, track, rank, player_id, updated_at)
  select p_team_id, p_season, p_item_id, p_track, ord::integer, (elem)::integer, now()
  from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) with ordinality as t(elem, ord);

  get diagnostics v_count = row_count;

  select name into v_item_name from public.items where id = p_item_id;

  perform public.write_audit_log(
    p_team_id,
    'Priority Order Saved',
    'items',
    p_item_id,
    jsonb_build_object('item', v_item_name, 'track', p_track, 'players', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.save_priority_order(integer, text, integer, text, jsonb) from public;
revoke execute on function public.save_priority_order(integer, text, integer, text, jsonb) from anon;
grant execute on function public.save_priority_order(integer, text, integer, text, jsonb) to authenticated;
