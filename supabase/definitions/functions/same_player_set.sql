-- Function public.same_player_set: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.same_player_set(a integer[], b integer[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select array_agg(distinct x order by x) from unnest(a) x), '{}')
       = coalesce((select array_agg(distinct x order by x) from unnest(b) x), '{}');
$function$;
