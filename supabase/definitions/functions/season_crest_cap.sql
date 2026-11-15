-- Function public.season_crest_cap: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.season_crest_cap(p_season text, p_track text, p_week date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
           when not c.capped or (c.caps_lifted_on is not null and p_week >= c.caps_lifted_on) then null
           when p_week < c.first_week then 0
           else c.weekly_increase * ((p_week - c.first_week) / 7 + 1)
         end
    from season_crests c
   where c.season = p_season and c.track = p_track;
$function$;
