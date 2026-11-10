-- Function public.bot_mark_recruit_joined: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_mark_recruit_joined(p_application_id integer, p_actor_discord_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  perform recruit_trial_joined(p_application_id, recruit_trial_bot_actor(p_application_id, p_actor_discord_id));
end;
$function$;
