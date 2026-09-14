-- Function public.admin_set_maintenance_mode: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_set_maintenance_mode(p_enabled boolean, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.site_settings
  set maintenance_mode = p_enabled, maintenance_message = p_message, updated_at = now()
  where id = 1;

  perform public.write_audit_log(
    null,
    case when p_enabled then 'maintenance_mode_enabled' else 'maintenance_mode_disabled' end,
    'site_settings',
    null,
    case when p_message is not null then jsonb_build_object('message', p_message) else null end
  );
end;
$function$;
