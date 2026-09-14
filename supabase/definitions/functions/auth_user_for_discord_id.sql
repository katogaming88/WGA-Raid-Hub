-- Function public.auth_user_for_discord_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.auth_user_for_discord_id(p_discord_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.user_id
  from auth.identities i
  where i.provider_id = p_discord_id and i.provider = 'discord';
$function$;
