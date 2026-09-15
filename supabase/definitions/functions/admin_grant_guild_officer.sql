-- Function public.admin_grant_guild_officer: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_grant_guild_officer(p_discord_id text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select admin_grant('guild_officer', p_discord_id, 'guild officer'); $function$;
