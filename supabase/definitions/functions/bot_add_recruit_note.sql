-- Function public.bot_add_recruit_note: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_add_recruit_note(p_application_id integer, p_actor_discord_id text, p_body text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_actor integer := bot_actor(p_actor_discord_id);
begin
  perform bot_check(p_application_id, v_actor, true);
  return recruit_add_note(p_application_id, v_actor, 'discord', p_body);
end;
$function$;
