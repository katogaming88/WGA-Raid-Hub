-- Function public.bot_close_no_reply: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_close_no_reply(p_application_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_hours integer;
  v_from timestamptz;
begin
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found or v_app.closed_at is not null or v_app.status <> 'waiting_on_applicant' then
    return false;
  end if;
  -- The deadline again, under the lock: a newer officer message or a reopen
  -- saved since the sweep decided starts the wait over (CodeRabbit).
  select r.close_no_reply_after_hours into v_hours from team_recruiting r where r.team_id = v_app.team_id;
  select greatest(v_app.officers_last_message_at, max(e.created_at)) into v_from
    from recruit_events e
   where e.application_id = p_application_id and e.kind = 'reopened';
  if v_hours is null or v_from is null or v_from + make_interval(hours => v_hours) > now() then
    return false;
  end if;
  perform recruit_close(p_application_id, null, 'no_reply', null);
  return true;
end;
$function$;
