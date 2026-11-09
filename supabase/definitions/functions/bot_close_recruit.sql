-- Function public.bot_close_recruit: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_close_recruit(p_application_id integer, p_actor_discord_id text, p_status text, p_reason text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select recruit_close(p_application_id, bot_actor(p_actor_discord_id), p_status, p_reason);
$function$;
