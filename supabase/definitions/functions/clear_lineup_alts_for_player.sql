-- Function public.clear_lineup_alts_for_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.clear_lineup_alts_for_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.team_member_id is not distinct from old.team_member_id
     or not exists (select 1 from raid_night_lineups where player_id = new.id and character_id is not null
                    union all
                    select 1 from boss_groups where player_id = new.id and character_id is not null) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), new.team_id);
  update boss_groups set character_id = null, class_spec_id = null
   where player_id = new.id and character_id is not null;
  update raid_night_lineups set character_id = null, class_spec_id = null
   where player_id = new.id and character_id is not null;
  return new;
end;
$function$;
