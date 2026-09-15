-- Function public.admin_list_site_admins: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_list_site_admins()
 RETURNS TABLE(id integer, discord_id text, auth_user_id uuid, display_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select * from admin_list_grants('site_admin'); $function$;
