-- Function public.recruit_trial_site_actor: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_site_actor(p_application_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select a.team_id into v_team from recruit_applications a where a.id = p_application_id;
  if recruit_access(v_team) is distinct from 'manage'
     or not (has_team_permission(v_team, 'edit_roster') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  return my_person_id();
end;
$function$;
