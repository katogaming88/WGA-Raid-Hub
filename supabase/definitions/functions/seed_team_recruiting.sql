-- Function public.seed_team_recruiting: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.seed_team_recruiting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into team_recruiting (team_id, listed_on_guild_page) values (new.id, not new.unlisted);
  return null;
end;
$function$;
