-- Function public.drop_archived_player_live_priority: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.drop_archived_player_live_priority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from priority_order
   where team_id = new.team_id
     and player_id = new.id
     and season = current_season();
  return new;
end;
$function$;
