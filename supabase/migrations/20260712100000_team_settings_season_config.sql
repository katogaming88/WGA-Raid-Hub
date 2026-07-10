-- #221 (Supabase Phase 6): season config off Script Properties, onto
-- team_settings.config. The table/RLS already existed (initial_schema.sql)
-- but nothing wrote to it yet -- these are the first functions that do.
--
-- All three are SECURITY INVOKER (the default): the underlying UPDATE runs
-- as the calling role, so the existing "Team leaders write settings" RLS
-- rule is the only access gate needed, same as calling
-- supabaseClient.from('team_settings').update(...) directly would be. Each
-- checks `if not found` after its UPDATE and raises rather than returning a
-- silent null -- a bare `update ... returning x into v` with 0 rows affected
-- (RLS blocked it) leaves v_config NULL with no error, which would otherwise
-- surface to the frontend as a crash on result.data.seasonName rather than a
-- clear "Not authorized".
--
-- set_team_setting is a generic single/multi-key jsonb merge, used for every
-- plain field (season name/dates, trial thresholds, raid progression, the
-- three signup/BiS/M+ toggles, the active signup season).
--
-- archive_current_season / unarchive_season replace the GAS
-- archiveSeason/unarchiveSeason actions, which moved seasonName/Start/End/
-- raidProgression into a seasonHistory entry (or back out). The GAS version
-- also snapshotted the roster into its own Script Property
-- (rosterSnapshot_<timestamp>) -- that snapshot now lives inline on the
-- history entry's "roster" key instead, so there's no longer a second
-- Script-Properties-shaped key namespace to manage or fetch separately.
-- The roster snapshot itself (nameRealm/role/isTrial/isBench/joinDate/
-- attendance per player) is computed client-side from data already in DATA,
-- same as it always was, and passed in rather than recomputed in SQL.

create or replace function public.set_team_setting(p_team_id integer, p_updates jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
begin
  update public.team_settings
  set config = config || p_updates
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  return v_config;
end;
$$;

revoke all on function public.set_team_setting(integer, jsonb) from public;
revoke execute on function public.set_team_setting(integer, jsonb) from anon;
grant execute on function public.set_team_setting(integer, jsonb) to authenticated;

create or replace function public.archive_current_season(p_team_id integer, p_roster_snapshot jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
  v_entry jsonb;
begin
  -- SELECT ... FOR UPDATE is filtered by both the SELECT and UPDATE RLS
  -- rules on this table (Postgres locks rows against the write rule too),
  -- so a caller without team_leader/site_admin gets 0 rows here -- same
  -- "Not authorized" outcome as failing the later UPDATE, just caught
  -- earlier and with one message instead of two.
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;
  if coalesce(v_config->>'seasonName', '') = '' then
    raise exception 'No active season to archive';
  end if;

  v_entry := jsonb_build_object(
    'name', coalesce(v_config->'seasonName', '""'::jsonb),
    'start', coalesce(v_config->'seasonStart', '""'::jsonb),
    'end', coalesce(v_config->'seasonEnd', '""'::jsonb),
    'raids', coalesce(v_config->'raidProgression', '[]'::jsonb),
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

  return v_config;
end;
$$;

revoke all on function public.archive_current_season(integer, jsonb) from public;
revoke execute on function public.archive_current_season(integer, jsonb) from anon;
grant execute on function public.archive_current_season(integer, jsonb) to authenticated;

create or replace function public.unarchive_season(p_team_id integer, p_index integer)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
  v_history jsonb;
  v_season jsonb;
begin
  -- SELECT ... FOR UPDATE is filtered by both the SELECT and UPDATE RLS
  -- rules on this table (Postgres locks rows against the write rule too),
  -- so a caller without team_leader/site_admin gets 0 rows here -- same
  -- "Not authorized" outcome as failing the later UPDATE, just caught
  -- earlier and with one message instead of two.
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;

  v_history := coalesce(v_config->'seasonHistory', '[]'::jsonb);
  if p_index < 0 or p_index >= jsonb_array_length(v_history) then
    raise exception 'Invalid season index';
  end if;

  v_season := v_history -> p_index;
  v_history := v_history - p_index;

  update public.team_settings
  set config = config || jsonb_build_object(
    'seasonName', coalesce(v_season->'name', '""'::jsonb),
    'seasonStart', coalesce(v_season->'start', '""'::jsonb),
    'seasonEnd', coalesce(v_season->'end', '""'::jsonb),
    'raidProgression', coalesce(v_season->'raids', '[]'::jsonb),
    'seasonHistory', v_history
  )
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  return jsonb_build_object('config', v_config, 'season', v_season);
end;
$$;

revoke all on function public.unarchive_season(integer, integer) from public;
revoke execute on function public.unarchive_season(integer, integer) from anon;
grant execute on function public.unarchive_season(integer, integer) to authenticated;
