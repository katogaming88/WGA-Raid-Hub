-- #1710: when RSVP changes post. Until now every change was its own post the
-- moment it happened. A team can now pick:
--
-- * as it happens: one post per change (no timing saved, as before);
-- * once a day: one post at a time the team picks, listing every change since
--   the last one;
-- * before each raid: one post a set number of hours before each raid night,
--   listing that night's changes.
--
-- A change for a raid that starts before the next batched post goes out at
-- once. The bot (discord-bot-webhook) decides what is due when it drains the
-- queue, from these four columns; nothing about the queue changes.
--
-- * team_discord_posts gets rsvp_when, rsvp_time, rsvp_timezone and
--   rsvp_hours, for the rsvp_changes kind only.
-- * set_team_rsvp_post(): how an officer sets the channel, ping role and
--   timing together, the same checks as set_team_discord_post() (which it
--   calls, so the old bot's columns and the audit row stay as they were).
-- * team_discord_settings() lists the four columns for the rsvp_changes kind.
--
-- Also, on Kat's OK: set_team_discord_server() failed for any team with a weekly
-- lineup post on. It clears each post's channel, and #1709's check refuses a
-- lineup with no channel that still holds a day, time and zone. It now clears
-- those three as well, and the RSVP timing, and brings waiting RSVP changes
-- forward so the next run skips them rather than posting them in the new
-- server. Found by the fresh review on #1763.

alter table public.team_discord_posts
  add column rsvp_when text check (rsvp_when in ('daily', 'before_raid')),
  add column rsvp_time time without time zone,
  add column rsvp_timezone text,
  add column rsvp_hours integer check (rsvp_hours between 1 and 168);

-- No timing means as it happens. Daily needs a time and a zone, before each
-- raid needs the hours, and only the RSVP changes kind holds any of it. The
-- channel is not part of it: set_team_discord_post() can turn the post off and
-- leaves the timing, which the bot ignores while the post is off.
alter table public.team_discord_posts add constraint team_discord_posts_rsvp_timing_check
  check (
    case
      when kind <> 'rsvp_changes' or rsvp_when is null
        then num_nonnulls(rsvp_when, rsvp_time, rsvp_timezone, rsvp_hours) = 0
      when rsvp_when = 'daily'
        then rsvp_time is not null and rsvp_timezone is not null and rsvp_hours is null
      else rsvp_hours is not null and rsvp_time is null and rsvp_timezone is null
    end
  );

comment on column public.team_discord_posts.rsvp_when is
  'For RSVP changes only (#1710): daily or before_raid for a batched post, empty for one post per change.';
comment on column public.team_discord_posts.rsvp_time is
  'For rsvp_when = daily: the time of day the post goes out, in rsvp_timezone.';
comment on column public.team_discord_posts.rsvp_timezone is
  'For rsvp_when = daily: the time zone rsvp_time is in.';
comment on column public.team_discord_posts.rsvp_hours is
  'For rsvp_when = before_raid: how many hours before each raid night the post goes out.';
comment on column public.discord_post_queue.next_try_at is
  'When it may post: now when queued, later after a failed try, or, for a batched RSVP change, when its batched post is due (#1710). Changing a team''s RSVP timing brings its waiting changes forward, so the next run decides them again.';

create function public.set_team_rsvp_post(
  p_team_id integer,
  p_channel_id text,
  p_ping_role_id text,
  p_when text,
  p_time time without time zone,
  p_timezone text,
  p_hours integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

comment on function public.set_team_rsvp_post(integer, text, text, text, time without time zone, text, integer) is
  'Sets the RSVP changes post (#1710): channel and ping role as set_team_discord_post() does, and when it posts: as it happens (no when), once a day at a time, or a number of hours before each raid. No channel turns it off and clears the timing. Changing the timing brings changes waiting in the queue forward, so the next run decides them again. For whoever holds Change Discord settings on the team, or a site admin.';

revoke all on function public.set_team_rsvp_post(integer, text, text, text, time without time zone, text, integer) from public, anon;
grant execute on function public.set_team_rsvp_post(integer, text, text, text, time without time zone, text, integer) to authenticated;

create or replace function public.team_discord_settings(p_team_id integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_config team_discord_config;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_config from team_discord_config c where c.team_id = p_team_id;

  return jsonb_build_object(
    'server_id', v_config.guild_id,
    'quiet_hours', case when v_config.quiet_hours_start is null then null else jsonb_build_object(
      'start', v_config.quiet_hours_start,
      'end', v_config.quiet_hours_end,
      'timezone', v_config.quiet_hours_timezone) end,
    'posts', (
      select jsonb_agg(jsonb_build_object(
               'kind', k.kind,
               'channel_id', p.channel_id,
               'ping_role_id', p.ping_role_id,
               'last_posted_at', p.last_posted_at,
               'post_weekday', p.post_weekday,
               'post_time', p.post_time,
               'post_timezone', p.post_timezone,
               'rsvp_when', p.rsvp_when,
               'rsvp_time', p.rsvp_time,
               'rsvp_timezone', p.rsvp_timezone,
               'rsvp_hours', p.rsvp_hours) order by k.n)
        from unnest(array['officer_requests', 'mplus_requests', 'rsvp_changes', 'weekly_lineup']) with ordinality as k(kind, n)
        left join team_discord_posts p on p.team_id = p_team_id and p.kind = k.kind),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'channel_id', s.channel_id,
               'raid_days', s.raid_days,
               'keep_raids_posted', s.keep_raids_posted,
               'hours_before', s.hours_before,
               'ping_role_id', s.ping_role_id,
               'last_posted_at', s.last_posted_at) order by s.raid_days[1], s.id)
        from team_discord_signup_sheets s
       where s.team_id = p_team_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.set_team_discord_server(p_team_id integer, p_server_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_sheets integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_server_id is null or p_server_id !~ '^[0-9]{17,20}$' then
    raise exception 'That is not a Discord server id';
  end if;
  if not exists (select 1 from teams t where t.id = p_team_id) then
    raise exception 'That team does not exist';
  end if;
  if not exists (select 1 from discord_server_access a
                  where a.person_id = my_person_id() and a.server_id = p_server_id
                    and a.verified_at > now() - interval '1 hour') then
    raise exception 'Pick a server you and the bot are both in';
  end if;

  -- A team's first pick inserts its row. Two officers making it at once: the
  -- second finds the first's row and changes it as any later pick does.
  insert into team_discord_config (team_id, guild_id) values (p_team_id, p_server_id)
  on conflict (team_id) do nothing;
  if not found then
    select c.guild_id into v_old from team_discord_config c where c.team_id = p_team_id for update;
    if v_old = p_server_id then
      return;
    end if;
    update team_discord_config
       set guild_id = p_server_id, old_bot = false,
           officer_channel_id = null, attendance_channel_id = null, signup_channel_id = null,
           mplus_ping_role_id = null, roster_ping_role_id = null, rsvp_ping_role_id = null,
           updated_at = now()
     where team_id = p_team_id;
    update team_discord_posts
       set channel_id = null, ping_role_id = null,
           post_weekday = null, post_time = null, post_timezone = null,
           rsvp_when = null, rsvp_time = null, rsvp_timezone = null, rsvp_hours = null,
           updated_at = now()
     where team_id = p_team_id and channel_id is not null;
    update discord_post_queue
       set next_try_at = now()
     where team_id = p_team_id and kind = 'rsvp_changes' and status = 'queued' and next_try_at > now();
    delete from team_discord_signup_sheets where team_id = p_team_id;
    get diagnostics v_sheets = row_count;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Server Set', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', p_server_id, 'sheets_removed', coalesce(v_sheets, 0)));
end;
$function$;
