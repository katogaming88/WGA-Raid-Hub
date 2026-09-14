-- Function public.notify_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.notify_player(p_player_id integer, p_message text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_id integer;
begin
  select team_id into v_team_id from players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Unknown player_id %', p_player_id;
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.notifications (team_id, player_id, message)
  values (v_team_id, p_player_id, p_message)
  returning id into v_id;

  return v_id;
end;
$function$;
