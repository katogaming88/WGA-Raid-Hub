-- #1709: the weekly boss lineup post. Once a week, on a day and time the team
-- picks, the bot posts the boss lineup for the coming raid week in a channel
-- the team picks, with an optional ping, and edits it when the lineup changes.
--
-- * A fourth kind in team_discord_posts, 'weekly_lineup', which also carries
--   the day, the time and the time zone it posts at. The other kinds carry
--   none of the three.
-- * team_lineup_posts: the message posted for each week, so later runs edit
--   it instead of posting again. Service role only, like raid_signup_sheets.
-- * set_team_weekly_lineup_post(): how an officer sets it, the same checks as
--   set_team_discord_post() plus the day, time and time zone.
-- * team_discord_settings() lists the new kind with its day, time and zone.

alter table public.team_discord_posts drop constraint team_discord_posts_kind_check;
alter table public.team_discord_posts add constraint team_discord_posts_kind_check
  check (kind in ('officer_requests', 'mplus_requests', 'rsvp_changes', 'weekly_lineup'));

alter table public.team_discord_posts
  add column post_weekday smallint check (post_weekday between 0 and 6),
  add column post_time time without time zone,
  add column post_timezone text;

-- The day, time and zone belong to the weekly lineup only, and an
-- unconfigured weekly lineup (no channel) holds none of them.
alter table public.team_discord_posts add constraint team_discord_posts_schedule_check
  check (
    case
      when kind = 'weekly_lineup' and channel_id is not null then num_nonnulls(post_weekday, post_time, post_timezone) = 3
      else num_nonnulls(post_weekday, post_time, post_timezone) = 0
    end
  );

comment on column public.team_discord_posts.post_weekday is
  'For the weekly lineup only (#1709): the day it posts, 0 is Sunday, in post_timezone.';
comment on column public.team_discord_posts.post_time is
  'For the weekly lineup only (#1709): the time it posts, in post_timezone.';
comment on column public.team_discord_posts.post_timezone is
  'For the weekly lineup only (#1709): the time zone its day and time are in.';

create table public.team_lineup_posts (
  team_id integer not null references public.teams (id) on delete cascade,
  week_of date not null,
  channel_id text not null,
  message_id text not null,
  posted_at timestamp with time zone not null default now(),
  primary key (team_id, week_of)
);

comment on table public.team_lineup_posts is
  'The weekly boss lineup message posted for each team and week (#1709). week_of is the date the post was due, in the team''s lineup time zone. Written by discord-bot-webhook with the service role; later runs edit this message when the lineup changes.';

alter table public.team_lineup_posts owner to postgres;
alter table public.team_lineup_posts enable row level security;

create policy "Claude readers read team_lineup_posts" on public.team_lineup_posts
  for select to claude_readers using (true);

revoke all on table public.team_lineup_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_lineup_posts to service_role;
grant select on table public.team_lineup_posts to claude_readers;

create or replace function public.set_team_weekly_lineup_post(
  p_team_id integer,
  p_channel_id text,
  p_ping_role_id text,
  p_weekday integer,
  p_time time without time zone,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    if p_timezone is null or not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
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
                                                      'weekday', p_weekday, 'time', p_time, 'timezone', p_timezone)));
end;
$$;

comment on function public.set_team_weekly_lineup_post(integer, text, text, integer, time without time zone, text) is
  'Sets the team''s weekly boss lineup post (#1709): its channel, ping role, day, time and time zone; no channel turns it off. For whoever holds Change Discord settings on the team, or a site admin.';

revoke all on function public.set_team_weekly_lineup_post(integer, text, text, integer, time without time zone, text) from public, anon;
grant execute on function public.set_team_weekly_lineup_post(integer, text, text, integer, time without time zone, text) to authenticated;

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
               'post_timezone', p.post_timezone) order by k.n)
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
