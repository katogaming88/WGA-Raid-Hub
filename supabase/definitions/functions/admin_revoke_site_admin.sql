-- Function public.admin_revoke_site_admin: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_revoke_site_admin(p_discord_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if (select count(*) from public.site_admins) <= 1 then
    raise exception 'Cannot revoke the last remaining site admin';
  end if;

  delete from public.site_admins where discord_id = p_discord_id
  returning id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have site admin access';
  end if;

  perform public.write_audit_log(null, 'site_admin_revoked', 'site_admin', v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$function$;
