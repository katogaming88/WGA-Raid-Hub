-- Function public.withdraw_application: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id integer)
 RETURNS void
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
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found or v_app.person_id is distinct from v_me then
    raise exception 'That application is not yours';
  end if;
  if v_app.closed_at is not null then
    raise exception 'That application is already closed';
  end if;
  if v_app.status = 'on_trial' then
    raise exception 'You''re on trial: ask the officers to end it';
  end if;
  update recruit_applications set status = 'withdrawn', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'withdrawn', v_me);
  perform recruit_log(v_app.team_id, v_me, 'Application Withdrawn', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm));
end;
$function$;
