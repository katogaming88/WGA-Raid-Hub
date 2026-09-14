-- Function public.set_guild_officer_bios: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_guild_officer_bios(p_bios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bios jsonb;
begin
  if not (public.is_site_admin() or public.is_guild_officer()) then
    raise exception 'Not authorized';
  end if;

  update public.site_settings
  set guild_officer_bios = p_bios, updated_at = now()
  where id = 1
  returning guild_officer_bios into v_bios;

  perform public.write_audit_log(
    null,
    'Guild Officer Bios Saved',
    'site_settings',
    null,
    jsonb_build_object('count', jsonb_array_length(p_bios))
  );

  return v_bios;
end;
$function$;
