-- Function public.recruit_trial_extend: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_extend(p_application_id integer, p_actor integer, p_reason text)
 RETURNS date
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_reason text := nullif(btrim(p_reason), '');
  v_ends date;
begin
  if v_reason is null then
    raise exception 'Say why the trial is extended';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;
  update recruit_applications a
     set trial_ends_on = a.trial_ends_on + r.trial_days
    from team_recruiting r
   where a.id = p_application_id and r.team_id = a.team_id
  returning a.trial_ends_on into v_ends;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'trial_extended', p_actor, 'Until ' || v_ends || ': ' || v_reason);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Trial Extended', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'reason', v_reason, 'trial_ends_on', v_ends));
  return v_ends;
end;
$function$;
