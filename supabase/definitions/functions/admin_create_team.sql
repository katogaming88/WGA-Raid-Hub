-- Function public.admin_create_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_create_team(p_name text, p_slug text, p_guild_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_guild integer;
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  v_guild := coalesce(p_guild_id, public.only_guild_id());
  if not exists (select 1 from public.guilds where id = v_guild) then
    raise exception 'There is no such guild';
  end if;

  insert into public.teams (name, slug, guild_id)
  values (p_name, p_slug, v_guild)
  returning id into v_id;

  -- Every other write path (set_team_setting, fetchSupabaseSettings) assumes
  -- a team_settings row already exists and errors/returns null otherwise; a
  -- team created here would have no row until someone happened to write to
  -- it first.
  insert into public.team_settings (team_id, config) values (v_id, '{}'::jsonb);

  perform public.write_audit_log(v_id, 'team_created', 'team', v_id, jsonb_build_object('name', p_name, 'slug', p_slug));

  return v_id;
end;
$function$;
