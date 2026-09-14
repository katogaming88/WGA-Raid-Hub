-- Function public.submit_bis_link: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.submit_bis_link(p_team_id integer, p_name_realm text, p_bis_link text, p_player_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_player_id integer;
  v_bis_allowed boolean;
  v_request_id integer;
begin
  if coalesce(trim(p_bis_link), '') = '' then
    raise exception 'BiS link cannot be blank';
  end if;

  select id, bis_allowed into v_player_id, v_bis_allowed
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select config into v_config from public.team_settings where team_id = p_team_id;
  if not (coalesce((v_config->>'bisSubmissionsOpen')::boolean, false) or coalesce(v_bis_allowed, false)) then
    raise exception 'BiS submissions are not open for this character';
  end if;

  if exists (
    select 1 from public.bis_requests where player_id = v_player_id and status = 'pending'
  ) then
    raise exception 'You already have a BiS submission pending officer review';
  end if;

  insert into public.bis_requests (team_id, player_id, bis_link, player_note, status)
  values (p_team_id, v_player_id, trim(p_bis_link), nullif(p_player_note, ''), 'pending')
  returning id into v_request_id;

  return v_request_id;
end $function$;
