-- Function public.recruit_log: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_log(p_team_id integer, p_actor integer, p_action text, p_application_id integer, p_detail jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, (select auth_user_id from people where id = p_actor), p_action,
          'recruit_applications', p_application_id, p_detail);
$function$;
