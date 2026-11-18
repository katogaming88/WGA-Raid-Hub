-- Function public.clear_lineup_picks_for_character: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.clear_lineup_picks_for_character()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update raid_night_lineups set character_id = null, class_spec_id = null where character_id = old.id;
  update boss_groups set character_id = null, class_spec_id = null where character_id = old.id;
  return old;
end;
$function$;
