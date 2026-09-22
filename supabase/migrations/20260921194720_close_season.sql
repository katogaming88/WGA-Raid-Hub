-- #938, third of four: the archive closes a tier's books, and only closes.
--
-- archive_current_season() started a season as much as it closed one: it
-- blanked the team's season name and dates, emptied the raid list, and the
-- site wrote the next tier's name back. Decision 13 on #1189 (2026-09-20)
-- made the season app-wide: the tier every team is on is current_season()
-- (#933), starting the day the tier goes live, so nothing per team starts
-- one and the archive has nothing to start.
--
-- close_season(p_team_id, p_season, p_roster_snapshot) only closes: it
-- refuses a tier seasons does not hold, a tier that has not ended (its start
-- on or after the current tier's, since current_season() is by start date)
-- and a tier the team has already closed; it folds the tier's raids from
-- raid_zones, raid_encounters and the team's team_raid_progress rows rather
-- than from raidProgression, so closing after the raid list has been rebuilt
-- for the new tier records the right raids; it appends the entry (code,
-- name, the tier's dates, raids, roster), resets M+ exclusion, Bench and the
-- BiS link as before, writes the audit entry itself, and leaves the raid
-- list, the dates and the season name alone. SECURITY INVOKER like the
-- function it replaces, so the team_settings write policy is the gate.
-- unarchive_season() goes with it: nothing is started, so nothing is undone.
--
-- The two history entries on production (both Midnight Season 1) gain code
-- through seasons.display_name; name stays for display and for the readers
-- of entries written before this. An entry whose name matches no tier keeps
-- no code. seasonName, seasonStart and seasonEnd are untouched here: the
-- name leaves in #938's fourth pull request, the dates in #1269.
--
-- A merge pushes this file before it publishes the site (#1083), so for up
-- to ten minutes a browser on the old bundle calls archive_current_season()
-- or unarchive_season() on a click and gets the error in the status line.

-- 1. The history entries gain the tier's code.
update public.team_settings ts
   set config = jsonb_set(
     ts.config,
     '{seasonHistory}',
     (
       select coalesce(jsonb_agg(
         case when s.code is not null then e.entry || jsonb_build_object('code', s.code) else e.entry end
         order by e.ord
       ), '[]'::jsonb)
         from jsonb_array_elements(ts.config -> 'seasonHistory') with ordinality as e(entry, ord)
         left join public.seasons s on s.display_name = e.entry ->> 'name'
     )
   )
 where jsonb_typeof(ts.config -> 'seasonHistory') = 'array'
   and jsonb_array_length(ts.config -> 'seasonHistory') > 0;

-- 2. The archive pair goes; close_season takes its place.
drop function if exists public.unarchive_season(integer, integer);
drop function if exists public.archive_current_season(integer, jsonb);

create or replace function public.close_season(p_team_id integer, p_season text, p_roster_snapshot jsonb)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_config jsonb;
  v_tier public.seasons%rowtype;
  v_current_start date;
  v_raids jsonb;
  v_entry jsonb;
begin
  -- Locked through the same select the write policy filters, so a caller the
  -- policy refuses sees no row and gets one Not authorized.
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;

  select * into v_tier from public.seasons where code = p_season;
  if not found then
    raise exception '% is not a season this site knows', p_season;
  end if;

  select s.starts_at into v_current_start
    from public.seasons s where s.code = public.current_season();
  if v_current_start is null or v_tier.starts_at >= v_current_start then
    raise exception '% has not ended', v_tier.display_name;
  end if;

  if coalesce(v_config -> 'seasonHistory', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('code', p_season)) then
    raise exception '% is already closed for this team', v_tier.display_name;
  end if;

  -- The tier's raids with the team's progress folded in: a zone appears when
  -- the team has a progress row on any of its bosses, in zone and boss order.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', rz.name,
      'wclZoneId', rz.wcl_zone_id,
      'isMiniRaid', rz.is_mini_raid,
      'bosses', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'name', re.name,
            'wclEncounterId', re.wcl_encounter_id,
            'mythicDate', trp.mythic_date,
            'mythicPulls', trp.mythic_pulls,
            'mythicBestPct', trp.mythic_best_pct
          )
          order by re.sort_index, re.id
        ), '[]'::jsonb)
          from public.raid_encounters re
          left join public.team_raid_progress trp
            on trp.encounter_id = re.id and trp.team_id = p_team_id
         where re.zone_id = rz.id
      )
    )
    order by rz.sort_index, rz.id
  ), '[]'::jsonb)
    into v_raids
    from public.raid_zones rz
   where rz.season = p_season
     and exists (
       select 1 from public.raid_encounters re
         join public.team_raid_progress trp on trp.encounter_id = re.id
        where re.zone_id = rz.id and trp.team_id = p_team_id
     );

  v_entry := jsonb_build_object(
    'code', v_tier.code,
    'name', v_tier.display_name,
    'start', v_tier.starts_at,
    'end', v_tier.ends_at,
    'raids', v_raids,
    'roster', coalesce(p_roster_snapshot, '[]'::jsonb)
  );

  update public.team_settings
     set config = config || jsonb_build_object(
       'seasonHistory', coalesce(v_config -> 'seasonHistory', '[]'::jsonb) || jsonb_build_array(v_entry)
     )
   where team_id = p_team_id
   returning config into v_config;
  if not found then
    raise exception 'Not authorized';
  end if;

  -- A new tier resets what the roster carries forward (#498): M+ exclusion,
  -- Bench, and the submitted BiS link. Trial status is left alone.
  update public.players
     set m_plus_excluded = false, m_plus_note = null
   where team_id = p_team_id and archived_at is null and m_plus_excluded = true;

  update public.players
     set is_bench = false
   where team_id = p_team_id and archived_at is null and is_bench = true;

  update public.players
     set bis_link = null
   where team_id = p_team_id and archived_at is null and bis_link is not null;

  -- Skipped only when nobody is signed in (a service-role call), because
  -- write_audit_log() needs an actor and would otherwise abort the close.
  if auth.uid() is not null then
    perform public.write_audit_log(
      p_team_id, 'Season Closed', 'team_settings', p_team_id, jsonb_build_object('season', p_season)
    );
  end if;

  return v_config;
end;
$function$;

revoke all on function public.close_season(integer, text, jsonb) from public, anon;
grant execute on function public.close_season(integer, text, jsonb) to authenticated;
