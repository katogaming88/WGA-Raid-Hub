-- Function public.recruit_add_note: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_add_note(p_application_id integer, p_actor integer, p_source text, p_body text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_id integer;
begin
  v_app := recruit_lock(p_application_id, p_actor);
  insert into recruit_notes (application_id, author_person_id, source, body)
  values (p_application_id, p_actor, p_source, btrim(p_body))
  returning id into v_id;
  insert into recruit_events (application_id, kind, actor_person_id)
  values (p_application_id, 'note_added', p_actor);
  -- Who and where, never the note itself.
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Note Added', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'source', p_source));
  return v_id;
end;
$function$;
