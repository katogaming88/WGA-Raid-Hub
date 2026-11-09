-- Function public.recruit_reopen: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_reopen(p_application_id integer, p_actor integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
begin
  v_app := recruit_lock(p_application_id);
  if v_app.status not in ('declined', 'no_reply') then
    raise exception 'Only a declined or no-reply recruit can be reopened';
  end if;
  if exists (select 1 from recruit_applications a
              where a.team_id = v_app.team_id and a.person_id = v_app.person_id and a.closed_at is null) then
    raise exception 'That person has another open application with this team';
  end if;
  update recruit_applications set status = 'waiting_on_officers', closed_at = null where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'reopened', p_actor);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Reopened', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm));
end;
$function$;
