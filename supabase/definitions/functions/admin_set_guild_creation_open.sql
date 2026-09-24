-- Function public.admin_set_guild_creation_open: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_set_guild_creation_open(p_open boolean)
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
     set guild_creation_open = p_open, updated_at = now()
   where id = 1;

  perform public.write_audit_log(
    null,
    case when p_open then 'guild_creation_opened' else 'guild_creation_closed' end,
    'site_settings',
    null,
    null
  );
end;
$function$;
