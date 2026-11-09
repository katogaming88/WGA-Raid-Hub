-- Function public.bot_close_recruit: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_close_recruit(p_application_id integer, p_actor_discord_id text, p_status text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_actor integer := bot_actor(p_actor_discord_id);
begin
  perform bot_check(p_application_id, v_actor, false);
  perform recruit_close(p_application_id, v_actor, p_status, p_reason);
end;
$function$;
