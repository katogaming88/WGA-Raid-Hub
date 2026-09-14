-- Function public.check_team_id_matches_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.check_team_id_matches_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.player_id is not null then
    if new.team_id != (select team_id from players where id = new.player_id) then
      raise exception 'team_id % does not match players.team_id for player_id %',
        new.team_id, new.player_id;
    end if;
  end if;
  return new;
end $function$;
