-- Function public.submit_mplus_exclusion: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.submit_mplus_exclusion(p_team_id integer, p_name_realm text, p_raiderio_url text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_player_id integer;
  v_request_id integer;
begin
  select config into v_config from public.team_settings where team_id = p_team_id;
  if not coalesce((v_config->>'mPlusExclusionsOpen')::boolean, false) then
    raise exception 'M+ exclusion requests are not open for this team';
  end if;

  select id into v_player_id
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  insert into public.mplus_exclusion_requests (team_id, player_id, reason, raiderio_url, status)
  values (p_team_id, v_player_id, nullif(p_reason, ''), nullif(p_raiderio_url, ''), 'pending')
  returning id into v_request_id;

  return v_request_id;
end $function$;
