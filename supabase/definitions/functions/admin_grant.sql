-- Function public.admin_grant: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.admin_grant(p_grant_type text, p_discord_id text, p_label text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_person integer;
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.discord_id = p_discord_id
       and g.grant_type = p_grant_type
  ) then
    raise exception 'That Discord account already has % access', p_label;
  end if;

  v_person := person_for_discord_id(p_discord_id);

  insert into guild_grants (person_id, guild_id, grant_type)
  values (v_person, only_guild_id(), p_grant_type)
  returning guild_grants.id into v_id;

  perform write_audit_log(null, p_grant_type || '_granted', p_grant_type, v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$function$;
