-- Function public.lockout_start_at: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.lockout_start_at(p_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select public.lockout_week_start(((p_at at time zone 'UTC') - interval '15 hours')::date); $function$;
