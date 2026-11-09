-- Function public.bot_reopen_recruit: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_reopen_recruit(p_application_id integer, p_actor_discord_id text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select recruit_reopen(p_application_id, bot_actor(p_actor_discord_id));
$function$;
