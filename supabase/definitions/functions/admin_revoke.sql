-- Function public.admin_revoke: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.admin_revoke(p_grant_type text, p_discord_id text, p_label text)
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

  if p_grant_type = 'site_admin'
     and (select count(*) from guild_grants where grant_type = 'site_admin') <= 1 then
    raise exception 'Cannot revoke the last remaining site admin';
  end if;

  delete from guild_grants g
   using people p
   where p.id = g.person_id
     and p.discord_id = p_discord_id
     and g.grant_type = p_grant_type
  returning g.id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have % access', p_label;
  end if;

  perform write_audit_log(null, p_grant_type || '_revoked', p_grant_type, v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$function$;
