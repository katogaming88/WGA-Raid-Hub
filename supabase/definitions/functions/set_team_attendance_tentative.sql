-- Function public.set_team_attendance_tentative: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_attendance_tentative(p_team_id integer, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
begin
  if not (
    public.has_team_permission(p_team_id, 'promote_assistants')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_status is not null and p_status not in
    ('Present', 'Bench', 'Late (with notice)', 'Excused', 'Late (no notice)', 'No Show') then
    raise exception '% is not a status a Tentative RSVP can become.', p_status;
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('attendanceTentative', p_status)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Attendance Tentative Saved',
    'team_settings',
    null,
    to_jsonb(coalesce(p_status, 'Needs a look'))
  );

  return v_config;
end;
$function$;
