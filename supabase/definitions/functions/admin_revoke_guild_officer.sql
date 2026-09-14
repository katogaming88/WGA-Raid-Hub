-- Function public.admin_revoke_guild_officer: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_revoke_guild_officer(p_discord_id text)
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

  delete from public.guild_officers where discord_id = p_discord_id
  returning id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have guild officer access';
  end if;

  perform public.write_audit_log(null, 'guild_officer_revoked', 'guild_officer', v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$function$;
