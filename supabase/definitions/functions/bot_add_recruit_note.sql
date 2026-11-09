-- Function public.bot_add_recruit_note: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_add_recruit_note(p_application_id integer, p_actor_discord_id text, p_body text)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select recruit_add_note(p_application_id, bot_actor(p_actor_discord_id), 'discord', p_body);
$function$;
