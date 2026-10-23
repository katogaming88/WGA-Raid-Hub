-- Function public.signup_wishlist_open: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.signup_wishlist_open(p_signup_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from season_signups s
      join team_seasons ts on ts.team_id = s.team_id and ts.season_code = s.season
     where s.id = p_signup_id and ts.wishlist_open
  );
$function$;
