-- Function public.clear_lineup_picks_for_character: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.clear_lineup_picks_for_character()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
begin
  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id then
    return new;
  end if;

  for v_team in
    select team_id from raid_night_lineups where character_id = old.id
    union
    select team_id from boss_groups where character_id = old.id
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  update boss_groups set character_id = null, class_spec_id = null where character_id = old.id;
  update raid_night_lineups set character_id = null, class_spec_id = null where character_id = old.id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;
