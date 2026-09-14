-- Function public.keep_player_url_code: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.keep_player_url_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.url_code is distinct from old.url_code then
    raise exception 'players.url_code cannot change once issued (#1114)';
  end if;
  return new;
end;
$function$;
