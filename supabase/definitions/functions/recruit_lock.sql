-- Function public.recruit_lock: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_lock(p_application_id integer)
 RETURNS recruit_applications
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
begin
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found then
    raise exception 'That recruit does not exist';
  end if;
  perform 1 from teams t where t.id = v_app.team_id and t.archived_at is null for share;
  if not found then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  return v_app;
end;
$function$;
