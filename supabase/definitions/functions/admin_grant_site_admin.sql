-- Function public.admin_grant_site_admin: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_grant_site_admin(p_discord_id text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select admin_grant('site_admin', p_discord_id, 'site admin'); $function$;
