-- Function public.create_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.create_team(p_guild_id integer, p_name text)
 RETURNS TABLE(team_id integer, team_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_discord_id text;
  v_name text := trim(coalesce(p_name, ''));
  v_team_id integer;
  v_team_key text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_guild_officer_of(p_guild_id) then
    raise exception 'Not authorized';
  end if;

  -- team_members is keyed on the Discord id, as in create_guild().
  v_discord_id := public.current_discord_id();
  if v_discord_id is null then
    raise exception 'Connect Discord before adding a team';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (select 1 from teams t where t.guild_id = p_guild_id and lower(t.name) = lower(v_name)) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  insert into teams (name, guild_id)
  values (v_name, p_guild_id)
  returning id, slug into v_team_id, v_team_key;

  -- Every write path assumes a team_settings row already exists.
  insert into team_settings (team_id, config) values (v_team_id, '{}'::jsonb);

  -- The trigger resolves the person and its account from the Discord id.
  insert into team_members (team_id, discord_id, role)
  values (v_team_id, v_discord_id, 'team_leader');

  perform public.write_audit_log(v_team_id, 'Team Created', 'teams', v_team_id,
                                 jsonb_build_object('name', v_name, 'key', v_team_key));

  return query select v_team_id, v_team_key;
end;
$function$;
