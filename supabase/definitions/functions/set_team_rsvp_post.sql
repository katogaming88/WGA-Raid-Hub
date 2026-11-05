-- Function public.set_team_rsvp_post: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_rsvp_post(p_team_id integer, p_channel_id text, p_ping_role_id text, p_when text, p_time time without time zone, p_timezone text, p_hours integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_posts;
  v_when text := case when p_channel_id is null then null else p_when end;
  v_time time without time zone := case when v_when = 'daily' then p_time end;
  v_timezone text := case when v_when = 'daily' then p_timezone end;
  v_hours integer := case when v_when = 'before_raid' then p_hours end;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_when is not null and p_when not in ('daily', 'before_raid') then
    raise exception 'Pick when it posts';
  end if;
  if v_when = 'daily' then
    if v_time is null then
      raise exception 'Pick the time it posts';
    end if;
    -- Not the posix/ and right/ copies, which Deno's clock can't read.
    if v_timezone is null or v_timezone ~ '^(posix|right)/'
       or not exists (select 1 from pg_timezone_names z where z.name = v_timezone) then
      raise exception 'Pick a time zone';
    end if;
  elsif v_when = 'before_raid' then
    if v_hours is null or v_hours not between 1 and 168 then
      raise exception 'Post 1 to 168 hours before each raid';
    end if;
  end if;

  -- The channel and ping role, with every check and the old bot's columns.
  perform set_team_discord_post(p_team_id, 'rsvp_changes', p_channel_id, p_ping_role_id);

  select * into v_old from team_discord_posts p where p.team_id = p_team_id and p.kind = 'rsvp_changes';
  if not found then
    return;
  end if;
  if v_old.rsvp_when is not distinct from v_when
     and v_old.rsvp_time is not distinct from v_time
     and v_old.rsvp_timezone is not distinct from v_timezone
     and v_old.rsvp_hours is not distinct from v_hours then
    return;
  end if;

  update team_discord_posts
     set rsvp_when = v_when, rsvp_time = v_time, rsvp_timezone = v_timezone, rsvp_hours = v_hours,
         updated_at = now()
   where team_id = p_team_id and kind = 'rsvp_changes';

  -- Changes waiting under the old timing come up on the next run, which decides
  -- them again under the new one. Left alone, a team that moved to "as it
  -- happens" would hear of them only when the old post was due.
  update discord_post_queue
     set next_try_at = now()
   where team_id = p_team_id and kind = 'rsvp_changes' and status = 'queued' and next_try_at > now();

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord RSVP Timing Set', 'teams', p_team_id,
          jsonb_build_object(
            'from', jsonb_build_object('when', v_old.rsvp_when, 'time', v_old.rsvp_time,
                                       'timezone', v_old.rsvp_timezone, 'hours', v_old.rsvp_hours),
            'to', jsonb_build_object('when', v_when, 'time', v_time, 'timezone', v_timezone, 'hours', v_hours)));
end;
$function$;
