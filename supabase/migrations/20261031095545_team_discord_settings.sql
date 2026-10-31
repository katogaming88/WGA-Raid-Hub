-- #1712: a team's Discord settings in the database, changed by its officers
-- through functions (the database half of #994, with #921's per-type
-- channels folded in).
--
-- What this adds:
--
-- * team_discord_posts: one row per kind of post the bot makes for a team
--   (officer requests, M+ requests, RSVP changes; main swap requests and more
--   join the kind list later). Each has a channel, an optional ping role and
--   when it last posted. No channel means that kind is off.
-- * team_discord_signup_sheets: as many signup sheets as a team wants, each
--   with a channel, its raid days (raid_schedule's weekday, 0 = Sunday), how
--   it posts (keep 1 to 4 raids posted, or post a number of hours before each
--   raid) and an optional ping role. A day is on one sheet of a team at most.
-- * Quiet hours on team_discord_config: a start, an end and the time zone
--   they are in, or all three empty for off.
-- * change_discord_settings, a new team permission, on for Officers.
-- * Six functions, the only way in for the site: team_discord_settings()
--   reads it all, and set_team_discord_server(), set_team_discord_post(),
--   save_team_discord_signup_sheet(), remove_team_discord_signup_sheet() and
--   set_team_discord_quiet_hours() change one thing each, writing an audit
--   row only when something changed.
--
-- The server is picked by the team's officers now, not site admins. These
-- functions only check an id looks like a Discord id; that the bot and the
-- officer are both in that server is checked by the call that reads Discord
-- (#994's other half).
--
-- Changing the server clears every post's channel and ping role and removes
-- the team's signup sheets: channel ids are global in Discord, so a channel
-- left behind would keep the bot posting into the old server.
--
-- The old bot on the VM keeps reading the old columns until #959 and #960 move
-- posting into the site, so saving the three kinds of post writes them too:
--
--   officer_requests  channel -> officer_channel_id (when one is picked),
--                     ping role -> roster_ping_role_id
--   mplus_requests    ping role -> mplus_ping_role_id (the old bot posts M+
--                     requests in the officer channel, so it has no channel)
--   rsvp_changes      channel -> attendance_channel_id, ping role ->
--                     rsvp_ping_role_id
--
-- The old bot has no "off": with no attendance channel it posts RSVP changes
-- in the officer channel, and turning officer requests off leaves its officer
-- channel as it was. Signup sheets are not copied to signup_channel_id: the
-- sheet's switchover is #960's.
--
-- The three one-team-per-channel unique constraints come off: teams in one
-- server may share a channel now. officer_channel_id may be empty, for a team
-- that has picked its server and nothing else yet.

alter table public.team_discord_config
  drop constraint team_discord_config_officer_channel_id_key,
  drop constraint team_discord_config_attendance_channel_id_key,
  drop constraint team_discord_config_signup_channel_id_key,
  alter column officer_channel_id drop not null,
  add column quiet_hours_start time,
  add column quiet_hours_end time,
  add column quiet_hours_timezone text,
  add constraint team_discord_config_quiet_hours check (
    (quiet_hours_start is null and quiet_hours_end is null and quiet_hours_timezone is null)
    or (quiet_hours_start is not null and quiet_hours_end is not null
        and quiet_hours_timezone is not null and quiet_hours_start <> quiet_hours_end)
  );

comment on table public.team_discord_config is
  'A team''s Discord server, quiet hours and the old bot''s channel and ping role ids (#991, #1712). Read and changed by the team''s officers through team_discord_settings() and the set_team_discord_* functions; the old bot reads it with the service key. Each kind of post is in team_discord_posts, each signup sheet in team_discord_signup_sheets.';
comment on column public.team_discord_config.quiet_hours_start is
  'When quiet hours start, in quiet_hours_timezone (#1712). Posts made in quiet hours are held until they end. Empty with the end and the time zone for off.';
comment on column public.team_discord_config.quiet_hours_end is
  'When quiet hours end, in quiet_hours_timezone (#1712). Earlier than the start when they run past midnight.';
comment on column public.team_discord_config.quiet_hours_timezone is
  'The time zone quiet hours are in, an IANA name such as America/New_York (#1712).';

create table public.team_discord_posts (
  team_id integer not null references public.team_discord_config(team_id) on delete cascade,
  kind text not null check (kind in ('officer_requests', 'mplus_requests', 'rsvp_changes')),
  channel_id text,
  ping_role_id text,
  last_posted_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, kind),
  check (channel_id is not null or ping_role_id is null)
);

comment on table public.team_discord_posts is
  'One row per kind of post the bot makes for a team (#1712, #921): its channel, an optional ping role and when it last posted. No channel (or no row) means that kind is off. Changed only through set_team_discord_post(); the posting function reads it with the service key.';

create table public.team_discord_signup_sheets (
  id integer generated always as identity primary key,
  team_id integer not null references public.team_discord_config(team_id) on delete cascade,
  channel_id text not null,
  raid_days integer[] not null check (cardinality(raid_days) > 0 and raid_days <@ array[0, 1, 2, 3, 4, 5, 6]),
  keep_raids_posted integer check (keep_raids_posted between 1 and 4),
  hours_before integer check (hours_before between 1 and 168),
  ping_role_id text,
  last_posted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (num_nonnulls(keep_raids_posted, hours_before) = 1)
);

create index team_discord_signup_sheets_team_id on public.team_discord_signup_sheets (team_id);

comment on table public.team_discord_signup_sheets is
  'A team''s signup sheets in Discord (#1712): the channel, its raid days (raid_schedule''s weekday, 0 = Sunday, each day on one sheet of a team at most), and either keep_raids_posted (1 to 4) or hours_before each raid. Changed only through save_team_discord_signup_sheet() and remove_team_discord_signup_sheet().';

alter table public.team_discord_posts owner to postgres;
alter table public.team_discord_posts enable row level security;
alter table public.team_discord_signup_sheets owner to postgres;
alter table public.team_discord_signup_sheets enable row level security;

create policy "Claude readers read team_discord_posts" on public.team_discord_posts
  for select to claude_readers using (true);
create policy "Claude readers read team_discord_signup_sheets" on public.team_discord_signup_sheets
  for select to claude_readers using (true);

-- Nobody reads or writes these directly: the officers' functions run as their
-- owner, and the posting function uses the service key.
revoke all on table public.team_discord_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_discord_posts to service_role;
revoke all on table public.team_discord_signup_sheets from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_discord_signup_sheets to service_role;

-- What the old columns already say, so the new page opens on what the bot
-- posts today.
insert into public.team_discord_posts (team_id, kind, channel_id, ping_role_id)
select c.team_id, k.kind, k.channel_id, case when k.channel_id is null then null else k.ping_role_id end
  from public.team_discord_config c
 cross join lateral (values
   ('officer_requests', c.officer_channel_id, c.roster_ping_role_id),
   ('mplus_requests', c.officer_channel_id, c.mplus_ping_role_id),
   ('rsvp_changes', coalesce(c.attendance_channel_id, c.officer_channel_id), c.rsvp_ping_role_id)
 ) as k(kind, channel_id, ping_role_id);

-- The grid row, last on the team grid, on for every team's Officers.
insert into public.rank_permissions (permission, scope, position, default_ranks)
values ('change_discord_settings', 'team', 14, '{officer}');

insert into public.team_rank_permissions (team_id, rank, permission)
select t.id, 'officer', 'change_discord_settings' from public.teams t;

-- Everything the Discord page shows for a team: its server, quiet hours, every
-- kind of post (off ones included) and its signup sheets. server_id is null
-- when the team has not picked one.
create function public.team_discord_settings(p_team_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
               'last_posted_at', p.last_posted_at) order by k.n)
        from unnest(array['officer_requests', 'mplus_requests', 'rsvp_changes']) with ordinality as k(kind, n)
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
$$;

comment on function public.team_discord_settings(integer) is
  'A team''s whole Discord setup for its Discord page (#1712): server_id, quiet_hours, posts (one per kind, off ones included) and sheets. For anyone whose team rank has change_discord_settings, and site admins.';

revoke all on function public.team_discord_settings(integer) from public, anon;
grant execute on function public.team_discord_settings(integer) to authenticated;

create function public.set_team_discord_server(p_team_id integer, p_server_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  select c.guild_id into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if v_old = p_server_id then
    return;
  end if;

  if v_old is null then
    insert into team_discord_config (team_id, guild_id) values (p_team_id, p_server_id);
  else
    update team_discord_config
       set guild_id = p_server_id,
           officer_channel_id = null, attendance_channel_id = null, signup_channel_id = null,
           mplus_ping_role_id = null, roster_ping_role_id = null, rsvp_ping_role_id = null,
           updated_at = now()
     where team_id = p_team_id;
    update team_discord_posts
       set channel_id = null, ping_role_id = null, updated_at = now()
     where team_id = p_team_id and channel_id is not null;
    delete from team_discord_signup_sheets where team_id = p_team_id;
    get diagnostics v_sheets = row_count;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Server Set', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', p_server_id, 'sheets_removed', coalesce(v_sheets, 0)));
end;
$$;

comment on function public.set_team_discord_server(integer, text) is
  'Picks the team''s Discord server (#1712). Changing it clears every kind of post''s channel and ping role and removes the team''s signup sheets, since they belong to the old server.';

revoke all on function public.set_team_discord_server(integer, text) from public, anon;
grant execute on function public.set_team_discord_server(integer, text) to authenticated;

-- One kind of post: its channel (null turns it off) and an optional ping role.
create function public.set_team_discord_post(
  p_team_id integer, p_kind text, p_channel_id text, p_ping_role_id text
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
  if p_kind is null or p_kind not in ('officer_requests', 'mplus_requests', 'rsvp_changes') then
    raise exception 'That is not a kind of post';
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
  perform 1 from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;

  select * into v_old from team_discord_posts p where p.team_id = p_team_id and p.kind = p_kind;
  if v_old.channel_id is not distinct from p_channel_id
     and v_old.ping_role_id is not distinct from p_ping_role_id then
    return;
  end if;

  insert into team_discord_posts (team_id, kind, channel_id, ping_role_id)
  values (p_team_id, p_kind, p_channel_id, p_ping_role_id)
  on conflict (team_id, kind) do update
    set channel_id = excluded.channel_id, ping_role_id = excluded.ping_role_id, updated_at = now();

  -- The old bot's columns, until #959 and #960.
  update team_discord_config c
     set officer_channel_id = case when p_kind = 'officer_requests' and p_channel_id is not null
                                   then p_channel_id else c.officer_channel_id end,
         roster_ping_role_id = case when p_kind = 'officer_requests' then p_ping_role_id else c.roster_ping_role_id end,
         mplus_ping_role_id = case when p_kind = 'mplus_requests' then p_ping_role_id else c.mplus_ping_role_id end,
         attendance_channel_id = case when p_kind = 'rsvp_changes' then p_channel_id else c.attendance_channel_id end,
         rsvp_ping_role_id = case when p_kind = 'rsvp_changes' then p_ping_role_id else c.rsvp_ping_role_id end,
         updated_at = now()
   where c.team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Post Set', 'teams', p_team_id,
          jsonb_build_object('kind', p_kind,
                             'from', jsonb_build_object('channel_id', v_old.channel_id, 'ping_role_id', v_old.ping_role_id),
                             'to', jsonb_build_object('channel_id', p_channel_id, 'ping_role_id', p_ping_role_id)));
end;
$$;

comment on function public.set_team_discord_post(integer, text, text, text) is
  'Sets one kind of post''s channel (null turns it off) and optional ping role (#1712), and the old bot''s columns for it until #959 and #960.';

revoke all on function public.set_team_discord_post(integer, text, text, text) from public, anon;
grant execute on function public.set_team_discord_post(integer, text, text, text) to authenticated;

-- Adds a sheet (p_sheet_id null) or changes one, and returns its id. Exactly
-- one of p_keep_raids_posted and p_hours_before. A day another sheet of the
-- team already has is refused, with that sheet's channel id in the error's
-- detail for the page to name.
create function public.save_team_discord_signup_sheet(
  p_team_id integer, p_sheet_id integer, p_channel_id text, p_raid_days integer[],
  p_keep_raids_posted integer, p_hours_before integer, p_ping_role_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

comment on function public.save_team_discord_signup_sheet(integer, integer, text, integer[], integer, integer, text) is
  'Adds a signup sheet (no sheet id) or changes one, returning its id (#1712). Refuses a raid day another sheet of the team has, with that sheet''s channel id as the error''s detail.';

revoke all on function public.save_team_discord_signup_sheet(integer, integer, text, integer[], integer, integer, text) from public, anon;
grant execute on function public.save_team_discord_signup_sheet(integer, integer, text, integer[], integer, integer, text) to authenticated;

create function public.remove_team_discord_signup_sheet(p_team_id integer, p_sheet_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_signup_sheets;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from team_discord_signup_sheets s
   where s.id = p_sheet_id and s.team_id = p_team_id
  returning * into v_old;
  if not found then
    raise exception 'That sheet is not on this team';
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Signup Sheet Removed', 'team_discord_signup_sheets', p_sheet_id,
          jsonb_build_object('channel_id', v_old.channel_id, 'raid_days', v_old.raid_days,
                             'keep_raids_posted', v_old.keep_raids_posted, 'hours_before', v_old.hours_before,
                             'ping_role_id', v_old.ping_role_id));
end;
$$;

comment on function public.remove_team_discord_signup_sheet(integer, integer) is
  'Removes one of the team''s signup sheets (#1712).';

revoke all on function public.remove_team_discord_signup_sheet(integer, integer) from public, anon;
grant execute on function public.remove_team_discord_signup_sheet(integer, integer) to authenticated;

-- Quiet hours on (all three given) or off (all three null).
create function public.set_team_discord_quiet_hours(
  p_team_id integer, p_start time, p_end time, p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_config;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if num_nonnulls(p_start, p_end, p_timezone) not in (0, 3) then
    raise exception 'Quiet hours need a start, an end and a time zone, or none of them for off';
  end if;
  if p_start = p_end then
    raise exception 'Quiet hours start and end at different times';
  end if;
  if p_timezone is not null and not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
    raise exception 'That is not a time zone';
  end if;

  select * into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;
  if v_old.quiet_hours_start is not distinct from p_start
     and v_old.quiet_hours_end is not distinct from p_end
     and v_old.quiet_hours_timezone is not distinct from p_timezone then
    return;
  end if;

  update team_discord_config
     set quiet_hours_start = p_start, quiet_hours_end = p_end, quiet_hours_timezone = p_timezone,
         updated_at = now()
   where team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Quiet Hours Set', 'teams', p_team_id,
          jsonb_build_object(
            'from', case when v_old.quiet_hours_start is null then null else jsonb_build_object(
              'start', v_old.quiet_hours_start, 'end', v_old.quiet_hours_end, 'timezone', v_old.quiet_hours_timezone) end,
            'to', case when p_start is null then null else jsonb_build_object(
              'start', p_start, 'end', p_end, 'timezone', p_timezone) end));
end;
$$;

comment on function public.set_team_discord_quiet_hours(integer, time, time, text) is
  'Turns the team''s Discord quiet hours on (a start, an end and an IANA time zone) or off (all three null) (#1712).';

revoke all on function public.set_team_discord_quiet_hours(integer, time, time, text) from public, anon;
grant execute on function public.set_team_discord_quiet_hours(integer, time, time, text) to authenticated;
