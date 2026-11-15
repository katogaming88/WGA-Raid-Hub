-- Function public.season_enchant_slots_on: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.season_enchant_slots_on(p_season text, p_day date)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.slot
    from season_enchant_slots s
   where s.season = p_season and (s.counts_from is null or s.counts_from <= p_day)
   order by s.slot;
$function$;
