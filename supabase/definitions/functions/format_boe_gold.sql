-- Function public.format_boe_gold: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.format_boe_gold(n bigint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select trim(to_char(n, 'FM999,999,999,999,999')); $function$;
