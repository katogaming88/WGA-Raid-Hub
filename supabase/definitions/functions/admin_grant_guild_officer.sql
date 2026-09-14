-- Function public.admin_grant_guild_officer: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_grant_guild_officer(p_discord_id text)
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

  if exists (select 1 from public.guild_officers where discord_id = p_discord_id) then
    raise exception 'That Discord account already has guild officer access';
  end if;

  insert into public.guild_officers (discord_id, auth_user_id)
  values (p_discord_id, public.auth_user_for_discord_id(p_discord_id))
  returning id into v_id;

  perform public.write_audit_log(null, 'guild_officer_granted', 'guild_officer', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$function$;
