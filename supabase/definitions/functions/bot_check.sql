-- Function public.bot_check: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_check(p_application_id integer, p_actor integer, p_note boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_access text;
begin
  select * into v_app from recruit_applications where id = p_application_id;
  if not found then
    raise exception 'That recruit does not exist';
  end if;
  v_access := recruit_actor_access(v_app.team_id, p_actor);
  if v_access = 'manage'
     or (p_note and (v_access = 'note'
                     or coalesce(v_app.recruiter_person_id = p_actor
                                 and in_guild((select t.guild_id from teams t where t.id = v_app.team_id), p_actor),
                                 false))) then
    return;
  end if;
  raise exception 'Not authorized';
end;
$function$;
