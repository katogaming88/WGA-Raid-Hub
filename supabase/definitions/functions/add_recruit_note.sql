-- Function public.add_recruit_note: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.add_recruit_note(p_application_id integer, p_body text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me integer := my_person_id();
  v_app recruit_applications;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_app from recruit_applications where id = p_application_id;
  if not (coalesce(recruit_access(v_app.team_id) in ('manage', 'note'), false)
          or coalesce(v_app.recruiter_person_id = v_me
                      and in_guild((select t.guild_id from teams t where t.id = v_app.team_id), v_me), false)) then
    raise exception 'Not authorized';
  end if;
  return recruit_add_note(p_application_id, v_me, 'site', p_body);
end;
$function$;
