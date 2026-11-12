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
begin
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found or v_app.closed_at is not null or v_app.status <> 'waiting_on_applicant' then
    return false;
  end if;
  perform recruit_close(p_application_id, null, 'no_reply', null);
  return true;
end;
$function$;
