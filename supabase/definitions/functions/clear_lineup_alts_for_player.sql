-- Function public.clear_lineup_alts_for_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.clear_lineup_alts_for_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only a row with an alt picked takes the lineup lock, so a claim or a
  -- join elsewhere on the team never waits on the Boss lineup. A save
  -- picking an alt for this row holds the row while it checks and writes
  -- (see the saves), so it either finished first and its pick is cleared
  -- here, or it found this change under way and asked for a reload
  -- (CodeRabbit on PR #1874).
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
