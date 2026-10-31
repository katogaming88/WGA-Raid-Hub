-- Function public.save_team_discord_signup_sheet: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_team_discord_signup_sheet(p_team_id integer, p_sheet_id integer, p_channel_id text, p_raid_days integer[], p_keep_raids_posted integer, p_hours_before integer, p_ping_role_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_signup_sheets;
  v_days integer[];
  v_taken record;
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_channel_id is null or p_channel_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord channel id';
  end if;
  if p_ping_role_id is not null and p_ping_role_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord role id';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_days from unnest(p_raid_days) as d;
  if cardinality(v_days) = 0 or not (v_days <@ array[0, 1, 2, 3, 4, 5, 6]) then
    raise exception 'Pick at least one raid day';
  end if;
  if num_nonnulls(p_keep_raids_posted, p_hours_before) <> 1 then
    raise exception 'A sheet keeps raids posted or posts hours before each raid, one of the two';
  end if;
  if p_keep_raids_posted not between 1 and 4 then
    raise exception 'A sheet keeps 1 to 4 raids posted';
  end if;
  if p_hours_before not between 1 and 168 then
    raise exception 'A sheet posts 1 to 168 hours before each raid';
  end if;
  -- The config row's lock makes two saves for one team take turns, so both
  -- cannot claim the same day.
  perform 1 from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;

  if p_sheet_id is not null then
    select * into v_old from team_discord_signup_sheets s
     where s.id = p_sheet_id and s.team_id = p_team_id;
    if not found then
      raise exception 'That sheet is not on this team';
    end if;
  end if;

  select s.channel_id, d into v_taken
    from team_discord_signup_sheets s, unnest(s.raid_days) as d
   where s.team_id = p_team_id and s.id is distinct from p_sheet_id and d = any (v_days)
   order by d
   limit 1;
  if found then
    raise exception '% is already on another signup sheet',
      (array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])[v_taken.d + 1]
      using detail = v_taken.channel_id;
  end if;

  if p_sheet_id is null then
    insert into team_discord_signup_sheets (team_id, channel_id, raid_days, keep_raids_posted, hours_before, ping_role_id)
    values (p_team_id, p_channel_id, v_days, p_keep_raids_posted, p_hours_before, p_ping_role_id)
    returning id into v_id;
  else
    v_id := p_sheet_id;
    if v_old.channel_id = p_channel_id and v_old.raid_days = v_days
       and v_old.keep_raids_posted is not distinct from p_keep_raids_posted
       and v_old.hours_before is not distinct from p_hours_before
       and v_old.ping_role_id is not distinct from p_ping_role_id then
      return v_id;
    end if;
    update team_discord_signup_sheets
       set channel_id = p_channel_id, raid_days = v_days, keep_raids_posted = p_keep_raids_posted,
           hours_before = p_hours_before, ping_role_id = p_ping_role_id, updated_at = now()
     where id = p_sheet_id;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Signup Sheet Saved', 'team_discord_signup_sheets', v_id,
          jsonb_build_object(
            'from', case when p_sheet_id is null then null else jsonb_build_object(
              'channel_id', v_old.channel_id, 'raid_days', v_old.raid_days,
              'keep_raids_posted', v_old.keep_raids_posted, 'hours_before', v_old.hours_before,
              'ping_role_id', v_old.ping_role_id) end,
            'to', jsonb_build_object(
              'channel_id', p_channel_id, 'raid_days', v_days,
              'keep_raids_posted', p_keep_raids_posted, 'hours_before', p_hours_before,
              'ping_role_id', p_ping_role_id)));
  return v_id;
end;
$function$;
