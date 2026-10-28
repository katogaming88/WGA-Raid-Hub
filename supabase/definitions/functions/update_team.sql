-- Function public.update_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.update_team(p_team_id integer, p_name text, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild_id integer;
  v_old_name text;
  v_old_key text;
  v_name text := trim(coalesce(p_name, ''));
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.name, t.slug into v_guild_id, v_old_name, v_old_key
    from teams t where t.id = p_team_id;
  if v_guild_id is null or not public.has_guild_permission(v_guild_id, 'rename_archive_teams') then
    raise exception 'Not authorized';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'Give the team a name of up to 60 characters';
  end if;
  if exists (
    select 1 from teams t
     where t.guild_id = v_guild_id and t.id <> p_team_id and lower(t.name) = lower(v_name)
  ) then
    raise exception 'This guild already has a team called %', v_name;
  end if;

  -- The same shape as the teams_slug_format check, said in words.
  if v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_key) not between 2 and 32 then
    raise exception 'An address is 2 to 32 letters, numbers and single dashes';
  end if;
  if exists (select 1 from teams t where t.guild_id = v_guild_id and t.id <> p_team_id and t.slug = v_key) then
    raise exception 'Another team in this guild already uses that address';
  end if;

  if v_name = v_old_name and v_key = v_old_key then
    return;
  end if;

  update teams set name = v_name, slug = v_key where id = p_team_id;

  -- Its own row: the caller need not be on the team (see the header).
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Updated', 'teams', p_team_id,
          jsonb_build_object('name', v_name, 'key', v_key, 'old_name', v_old_name, 'old_key', v_old_key));
end;
$function$;
