-- Function public.admin_grant_site_admin: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_grant_site_admin(p_discord_id text)
 RETURNS integer
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

  if exists (select 1 from public.site_admins where discord_id = p_discord_id) then
    raise exception 'That Discord account already has site admin access';
  end if;

  insert into public.site_admins (discord_id, auth_user_id)
  values (p_discord_id, public.auth_user_for_discord_id(p_discord_id))
  returning id into v_id;

  perform public.write_audit_log(null, 'site_admin_granted', 'site_admin', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$function$;
