-- Function public.raid_today: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.raid_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select (now() at time zone 'America/New_York')::date; $function$;
