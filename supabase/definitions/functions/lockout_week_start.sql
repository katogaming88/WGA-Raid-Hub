-- Function public.lockout_week_start: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.lockout_week_start(p_raid_date date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select p_raid_date - ((extract(isodow from p_raid_date)::integer + 5) % 7); $function$;
