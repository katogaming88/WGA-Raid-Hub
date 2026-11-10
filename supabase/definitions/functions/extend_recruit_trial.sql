-- Function public.extend_recruit_trial: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.extend_recruit_trial(p_application_id integer, p_reason text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return recruit_trial_extend(p_application_id, recruit_trial_site_actor(p_application_id), p_reason);
end;
$function$;
