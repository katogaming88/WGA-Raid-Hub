-- Function public.remove_player_priority_order: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.remove_player_priority_order(p_team_id integer, p_season text, p_player_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and player_id = p_player_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
