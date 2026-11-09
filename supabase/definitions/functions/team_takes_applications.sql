-- Function public.team_takes_applications: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_takes_applications(p_team_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from team_recruiting r join teams t on t.id = r.team_id
                  where r.team_id = p_team_id and r.taking_applications and t.archived_at is null);
$function$;
