-- Function public.current_season: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.current_season(p_on date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select code
  from public.seasons
  where starts_at <= p_on
  order by starts_at desc
  limit 1
$function$;
