-- Function public.set_team_weekly_lineup_post: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_weekly_lineup_post(p_team_id integer, p_channel_id text, p_ping_role_id text, p_weekday integer, p_time time without time zone, p_timezone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_posts;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_channel_id is not null and p_channel_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord channel id';
  end if;
  if p_ping_role_id is not null and p_ping_role_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord role id';
  end if;
  if p_channel_id is null and p_ping_role_id is not null then
    raise exception 'Pick a channel before a role to ping';
  end if;
  if p_channel_id is not null then
    if p_weekday is null or p_weekday not between 0 and 6 then
      raise exception 'Pick the day it posts';
    end if;
    if p_time is null then
      raise exception 'Pick the time it posts';
    end if;
    -- Not the posix/ and right/ copies, which Deno's clock can't read (fresh review on #1761).
    if p_timezone is null or p_timezone ~ '^(posix|right)/'
       or not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
      raise exception 'Pick a time zone';
    end if;
  end if;
  perform 1 from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;

  select * into v_old from team_discord_posts p where p.team_id = p_team_id and p.kind = 'weekly_lineup';
  -- The same values again change nothing and log nothing.
  if v_old.channel_id is not distinct from p_channel_id
     and v_old.ping_role_id is not distinct from p_ping_role_id
     and (p_channel_id is null
          or (v_old.post_weekday is not distinct from p_weekday::smallint
              and v_old.post_time is not distinct from p_time
              and v_old.post_timezone is not distinct from p_timezone)) then
    return;
  end if;

  -- Off clears the day, time and zone with the channel.
  insert into team_discord_posts (team_id, kind, channel_id, ping_role_id, post_weekday, post_time, post_timezone)
  values (p_team_id, 'weekly_lineup', p_channel_id, p_ping_role_id,
          case when p_channel_id is null then null else p_weekday end,
          case when p_channel_id is null then null else p_time end,
          case when p_channel_id is null then null else p_timezone end)
  on conflict (team_id, kind) do update
    set channel_id = excluded.channel_id, ping_role_id = excluded.ping_role_id,
        post_weekday = excluded.post_weekday, post_time = excluded.post_time,
        post_timezone = excluded.post_timezone, updated_at = now();

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Post Set', 'teams', p_team_id,
          jsonb_build_object('kind', 'weekly_lineup',
                             'from', jsonb_build_object('channel_id', v_old.channel_id, 'ping_role_id', v_old.ping_role_id,
                                                        'weekday', v_old.post_weekday, 'time', v_old.post_time,
                                                        'timezone', v_old.post_timezone),
                             'to', jsonb_build_object('channel_id', p_channel_id, 'ping_role_id', p_ping_role_id,
                                                      'weekday', case when p_channel_id is null then null else p_weekday end,
                                                      'time', case when p_channel_id is null then null else p_time end,
                                                      'timezone', case when p_channel_id is null then null else p_timezone end)));
end;
$function$;
