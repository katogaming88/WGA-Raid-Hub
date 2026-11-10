-- Function public.recruit_close: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_close(p_application_id integer, p_actor integer, p_status text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_status is null or p_status not in ('declined', 'no_reply') then
    raise exception 'A recruit is closed as declined or no_reply';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.closed_at is not null then
    raise exception 'That recruit is already closed';
  end if;
  if v_app.status = 'on_trial' then
    raise exception 'That recruit is on trial: end the trial instead';
  end if;
  update recruit_applications set status = p_status, closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, case p_status when 'declined' then 'declined' else 'closed' end, p_actor,
          case p_status when 'declined' then v_reason else concat_ws(': ', 'No reply', v_reason) end);
  perform recruit_log(v_app.team_id, p_actor,
                      case p_status when 'declined' then 'Recruit Declined' else 'Recruit Closed' end,
                      p_application_id, jsonb_build_object('name_realm', v_app.name_realm, 'reason', v_reason));
end;
$function$;
