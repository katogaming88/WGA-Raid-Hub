-- Function public.mark_recruit_joined: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.mark_recruit_joined(p_application_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform recruit_trial_joined(p_application_id, recruit_trial_site_actor(p_application_id));
end;
$function$;
