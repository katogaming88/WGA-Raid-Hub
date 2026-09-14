-- Function public.can_settle_boe: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.can_settle_boe(p_team_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_boe_manager()
    or public.is_site_admin()
    or coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false);
$function$;
