-- Function public.create_guild: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.create_guild(p_name text, p_region text, p_realm text, p_team_name text)
 RETURNS TABLE(guild_key text, team_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_realm text := trim(coalesce(p_realm, ''));
  v_team_name text := trim(coalesce(p_team_name, ''));
  v_guild_id integer;
  v_guild_key text;
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_site_admin() or public.guild_creation_open()) then
    raise exception 'Creating a guild is not open yet';
  end if;

  -- team_members is keyed on the Discord id, as claim_character() is.
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before creating a guild';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the guild a name of up to 60 characters';
  end if;
  if v_team_name = '' or length(v_team_name) > 60 then
    raise exception 'Give the first team a name of up to 60 characters';
  end if;
  if p_region is null or p_region not in ('us', 'eu', 'kr', 'tw') then
    raise exception 'Pick a region';
  end if;
  if v_realm = '' then
    raise exception 'Give the guild''s home realm';
  end if;

  if exists (select 1 from public.guilds g where lower(g.name) = lower(v_name)) then
    raise exception 'A guild called % already exists', v_name;
  end if;
  -- teams.name is unique across every guild until #1045.
  if exists (select 1 from public.teams t where lower(t.name) = lower(v_team_name)) then
    raise exception 'A team called % already exists', v_team_name;
  end if;

  insert into public.guilds (name, region, realm)
  values (v_name, p_region, v_realm)
  returning id, url_key into v_guild_id, v_guild_key;

  insert into public.teams (name, guild_id)
  values (v_team_name, v_guild_id)
  returning id, slug into v_team_id, v_team_key;

  -- Every write path assumes a team_settings row already exists.
  insert into public.team_settings (team_id, config) values (v_team_id, '{}'::jsonb);

  -- The trigger resolves the person and its account from the Discord id.
  insert into public.team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'team_leader');

  -- The caller may be a plain signed-in person, whom write_audit_log()'s
  -- officer gate would refuse; like the other self-service RPCs this writes
  -- its own row.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Guild Created', 'guilds', v_guild_id,
          jsonb_build_object('guild', v_name, 'team', v_team_name));

  return query select v_guild_key, v_team_key;
end;
$function$;
