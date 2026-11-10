-- Function public.bot_start_recruit_trial: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_start_recruit_trial(p_application_id integer, p_actor_discord_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return recruit_trial_start(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id));
end;
$function$;
