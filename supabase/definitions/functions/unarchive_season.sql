-- Function public.unarchive_season: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.unarchive_season(p_team_id integer, p_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;
