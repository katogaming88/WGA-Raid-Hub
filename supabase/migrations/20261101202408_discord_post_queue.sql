-- #962: every Discord notice goes through a queue, so quiet hours can hold
-- posts, a failed post is retried, and each one posts once.
--
-- Until now the page that made a change called discord-bot-webhook straight
-- after it, and the relay posted right away. A post that failed was gone, quiet
-- hours could not hold anything, a request row could be replayed into repeated
-- posts inside a minute, and the text came from what the page sent (CodeRabbit
-- on #1727).
--
-- What this adds:
--
-- * discord_post_queue: one row per notice, with the team, the kind of post
--   (the Settings › Discord setting it reads), what it is and the fields its
--   text is built from. Rows are added only by the writes below, from what they
--   saved, so nobody can queue made-up text.
-- * queue_discord_post(): the one way a row is added, and only when the team
--   has a channel for that kind of post. Callable only by the functions here.
-- * claim_discord_posts(): the posting run's claim, for the service role. It
--   takes the oldest due rows of teams not in quiet hours and marks them
--   taken, skipping rows another run holds, so a row posts once. A run that
--   dies holding rows frees them after ten minutes.
-- * The seven writes that post queue their notice: set_own_rsvp() (RSVP
--   changes), submit_season_signup(), add_own_character(), submit_bis_link(),
--   flag_bis_list_changed() and submit_self_received() when an officer has to
--   review it (officer requests), and submit_mplus_exclusion() (M+ requests).
--   Each body is otherwise unchanged. flag_bis_list_changed() queues nothing
--   when it finds its flag already waiting, so a second click no longer pings.
-- * discord-post-queue: a pg_cron job every minute that calls
--   discord-bot-webhook's drain with the optional-rsvp-reminders secret, which
--   the function and the Vault already hold.
--
-- my_recent_own_add() goes: add_own_character() queues its own notice now, and
-- nothing else read it.

create table public.discord_post_queue (
  id bigint generated always as identity primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  kind text not null check (kind in ('officer_requests', 'mplus_requests', 'rsvp_changes')),
  action text not null check (action in ('signup', 'addCharacter', 'selfreceived', 'bis', 'mplus', 'rsvp')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'posted', 'skipped', 'failed')),
  attempts integer not null default 0,
  next_try_at timestamp with time zone not null default now(),
  claimed_at timestamp with time zone,
  posted_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now()
);

create index discord_post_queue_queued on public.discord_post_queue (id) where status = 'queued';
create index discord_post_queue_team on public.discord_post_queue (team_id, created_at);

comment on table public.discord_post_queue is
  'Every Discord notice the bot posts to a team''s channels, queued by the write behind it and posted by discord-bot-webhook''s drain every minute (#962). Added only through queue_discord_post(), taken only through claim_discord_posts(). Service role only.';
comment on column public.discord_post_queue.kind is
  'The kind of post (team_discord_posts.kind) whose channel and ping role it uses, read when it posts.';
comment on column public.discord_post_queue.action is
  'What the notice is: the builder in discord-bot-webhook''s posts.ts that turns payload into the message.';
comment on column public.discord_post_queue.payload is
  'The fields the message is built from, written by the function that made the change from what it saved.';
comment on column public.discord_post_queue.status is
  'queued until it posts (posted), its kind of post is off or its team''s server is gone when it comes up (skipped), or it fails five times (failed).';
comment on column public.discord_post_queue.next_try_at is
  'When it may post: now when queued, later after a failed try.';
comment on column public.discord_post_queue.claimed_at is
  'When a posting run took it. A run that dies holding it frees it after ten minutes.';
comment on column public.discord_post_queue.last_error is
  'Why the last try did not post.';

alter table public.discord_post_queue enable row level security;

create policy "Claude readers read discord_post_queue" on public.discord_post_queue
  for select to claude_readers using (true);

revoke all on table public.discord_post_queue from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.discord_post_queue to service_role;
grant select on table public.discord_post_queue to claude_readers;

-- The one way a notice is queued. Not SECURITY DEFINER: the functions below
-- are, and run as the table's owner; nobody else may call it.
create function public.queue_discord_post(p_team_id integer, p_kind text, p_action text, p_payload jsonb)
returns void
language sql
set search_path = public
as $$
  insert into discord_post_queue (team_id, kind, action, payload)
  select p_team_id, p_kind, p_action, p_payload
   where exists (select 1 from team_discord_posts p
                  where p.team_id = p_team_id and p.kind = p_kind and p.channel_id is not null);
$$;

comment on function public.queue_discord_post(integer, text, text, jsonb) is
  'Queues one Discord notice for a team (#962), only when the team has a channel for that kind of post. Called by the writes that post; nobody else may call it.';

revoke all on function public.queue_discord_post(integer, text, text, jsonb) from public, anon, authenticated, service_role;

-- The posting run's claim: the oldest due rows of teams not in quiet hours,
-- each marked taken and counted as a try. Quiet hours run past midnight when
-- the end is earlier than the start.
create function public.claim_discord_posts(p_limit integer default 25)
returns table (id bigint, team_id integer, kind text, action text, payload jsonb, created_at timestamp with time zone, attempts integer)
language sql
set search_path = public
as $$
  update discord_post_queue q
     set claimed_at = now(), attempts = q.attempts + 1
   where q.id in (
     select d.id
       from discord_post_queue d
       left join team_discord_config c on c.team_id = d.team_id
      where d.status = 'queued'
        and d.next_try_at <= now()
        and (d.claimed_at is null or d.claimed_at < now() - interval '10 minutes')
        and not coalesce(
              case when c.quiet_hours_start < c.quiet_hours_end
                   then (now() at time zone c.quiet_hours_timezone)::time >= c.quiet_hours_start
                    and (now() at time zone c.quiet_hours_timezone)::time < c.quiet_hours_end
                   else (now() at time zone c.quiet_hours_timezone)::time >= c.quiet_hours_start
                     or (now() at time zone c.quiet_hours_timezone)::time < c.quiet_hours_end
              end, false)
      order by d.id
      limit p_limit
      for update of d skip locked)
  returning q.id, q.team_id, q.kind, q.action, q.payload, q.created_at, q.attempts;
$$;

comment on function public.claim_discord_posts(integer) is
  'Takes up to p_limit due Discord notices for posting (#962): queued, past next_try_at, not held by another run, and not in their team''s quiet hours. Marks each taken and counts the try. For discord-bot-webhook''s drain, as the service role.';

revoke all on function public.claim_discord_posts(integer) from public, anon, authenticated;
grant execute on function public.claim_discord_posts(integer) to service_role;

-- The seven writes that post. Each body is the one before this migration with
-- its queue_discord_post() call added.

CREATE OR REPLACE FUNCTION public.set_own_rsvp(p_team_id integer, p_raid_date date, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_is_bench boolean;
  v_is_optional boolean;
  v_name_realm text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select p.id, p.is_bench, p.name_realm into v_player_id, v_is_bench, v_name_realm
  from players p
  join team_members tm on tm.id = p.team_member_id
  where tm.person_id = public.my_person_id()
    and tm.archived_at is null
    and p.team_id = p_team_id
    and p.archived_at is null;

  if v_player_id is null then
    raise exception 'No active roster character found for this team.';
  end if;

  v_is_optional := is_optional_raid_night(p_team_id, p_raid_date);

  if v_is_bench and not v_is_optional then
    raise exception 'Bench players cannot set an RSVP status.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = v_player_id and raid_date = p_raid_date;
    return;
  end if;

  if p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not v_is_optional then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  insert into raid_rsvps (team_id, player_id, raid_date, status, note)
  values (p_team_id, v_player_id, p_raid_date, p_status, p_note)
  on conflict (team_id, player_id, raid_date)
  do update set status = excluded.status, note = excluded.note, updated_at = now();

  perform queue_discord_post(p_team_id, 'rsvp_changes', 'rsvp', jsonb_build_object(
    'charName', v_name_realm, 'raidDate', p_raid_date::text, 'status', p_status, 'note', p_note));
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_season_signup(p_team_id integer, p_name_realm text, p_class text, p_spec text, p_off_specs text DEFAULT ''::text, p_main_swap boolean DEFAULT false, p_player_note text DEFAULT NULL::text, p_swap_from_name_realm text DEFAULT NULL::text, p_season text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class_spec_id integer;
  v_role text;
  v_season text;
  v_open_count integer;
  v_signup_id integer;
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Not signed in';
  end if;

  if p_season is null then
    -- The deploy window's case: a bundle that names no tier gets the team's
    -- one open tier, and a team with several open needs the pick.
    select count(*), min(ts.season_code) into v_open_count, v_season
    from public.team_seasons ts
    where ts.team_id = p_team_id and ts.signups_open;
    if v_open_count > 1 then
      raise exception 'more than one season is open for this team; pick one';
    end if;
    if v_open_count = 0 then
      raise exception 'signups are not open for this team';
    end if;
  else
    v_season := p_season;
    if not exists (
      select 1 from public.team_seasons ts
      where ts.team_id = p_team_id and ts.season_code = p_season and ts.signups_open
    ) then
      raise exception 'signups are not open for that season on this team';
    end if;
  end if;

  select id, role into v_class_spec_id, v_role from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  insert into public.season_signups (
    team_id, signup_name_realm, class_spec_id, off_specs, main_swap,
    swap_class_spec_id, player_note, season, status, swap_from_name_realm,
    auth_user_id
  ) values (
    p_team_id, p_name_realm,
    case when p_main_swap then null else v_class_spec_id end,
    nullif(p_off_specs, ''), p_main_swap,
    case when p_main_swap then v_class_spec_id else null end,
    nullif(p_player_note, ''), v_season, 'pending',
    case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end,
    v_auth_user_id
  ) returning id into v_signup_id;

  -- The Discord name is for display only, as the signup page showed it.
  perform queue_discord_post(p_team_id, 'officer_requests', 'signup', jsonb_build_object(
    'charName', p_name_realm, 'className', p_class, 'mainSpec', p_spec, 'role', v_role,
    'offSpecs', nullif(p_off_specs, ''), 'mainSwap', p_main_swap,
    'swapFromNameRealm', case when p_main_swap then nullif(p_swap_from_name_realm, '') end,
    'notes', nullif(p_player_note, ''),
    'discord', (select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
                  from auth.users u where u.id = v_auth_user_id)));

  return v_signup_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_mplus_exclusion(p_team_id integer, p_name_realm text, p_raiderio_url text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_player_id integer;
  v_request_id integer;
begin
  select config into v_config from public.team_settings where team_id = p_team_id;
  if not coalesce((v_config->>'mPlusExclusionsOpen')::boolean, false) then
    raise exception 'M+ exclusion requests are not open for this team';
  end if;

  select id into v_player_id
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  insert into public.mplus_exclusion_requests (team_id, player_id, reason, raiderio_url, status)
  values (p_team_id, v_player_id, nullif(p_reason, ''), nullif(p_raiderio_url, ''), 'pending')
  returning id into v_request_id;

  perform queue_discord_post(p_team_id, 'mplus_requests', 'mplus', jsonb_build_object(
    'nameRealm', p_name_realm, 'raiderioUrl', nullif(p_raiderio_url, ''), 'notes', nullif(p_reason, '')));

  return v_request_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_bis_link(p_team_id integer, p_name_realm text, p_bis_link text, p_player_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_player_id integer;
  v_bis_allowed boolean;
  v_request_id integer;
begin
  if coalesce(trim(p_bis_link), '') = '' then
    raise exception 'BiS link cannot be blank';
  end if;

  select id, bis_allowed into v_player_id, v_bis_allowed
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select config into v_config from public.team_settings where team_id = p_team_id;
  if not (coalesce((v_config->>'bisSubmissionsOpen')::boolean, false) or coalesce(v_bis_allowed, false)) then
    raise exception 'BiS submissions are not open for this character';
  end if;

  if exists (
    select 1 from public.bis_requests where player_id = v_player_id and status = 'pending'
  ) then
    raise exception 'You already have a BiS submission pending officer review';
  end if;

  insert into public.bis_requests (team_id, player_id, bis_link, player_note, status)
  values (p_team_id, v_player_id, trim(p_bis_link), nullif(p_player_note, ''), 'pending')
  returning id into v_request_id;

  perform queue_discord_post(p_team_id, 'officer_requests', 'bis', jsonb_build_object(
    'nameRealm', p_name_realm, 'bisLink', trim(p_bis_link), 'notes', nullif(p_player_note, ''),
    'sameLink', false));

  return v_request_id;
end $function$;

CREATE OR REPLACE FUNCTION public.flag_bis_list_changed(p_team_id integer, p_name_realm text, p_player_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_bis_link text;
  v_existing_id integer;
  v_request_id integer;
begin
  select id, bis_link into v_player_id, v_bis_link
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(trim(v_bis_link), '') = '' then
    raise exception 'No BiS link on file to flag';
  end if;

  -- Re-clicking while a flag for the same link is still pending shouldn't
  -- pile up duplicate rows in the officer queue.
  select id into v_existing_id
  from public.bis_requests
  where player_id = v_player_id and status = 'pending' and bis_link = v_bis_link;
  if found then
    return v_existing_id;
  end if;

  insert into public.bis_requests (team_id, player_id, bis_link, player_note, status)
  values (p_team_id, v_player_id, v_bis_link, nullif(trim(p_player_note), ''), 'pending')
  returning id into v_request_id;

  perform queue_discord_post(p_team_id, 'officer_requests', 'bis', jsonb_build_object(
    'nameRealm', p_name_realm, 'bisLink', v_bis_link, 'notes', nullif(trim(p_player_note), ''),
    'sameLink', true));

  return v_request_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_self_received(p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text)
 RETURNS TABLE(id integer, auto_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_track_label text := case p_track
    when 'Myth' then ' at Mythic' when 'Hero' then ' at Heroic' when 'Champion' then ' on the Champion track'
    else '' end;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(p_source, '') = 'Other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say where the item came from in the note. An officer reviews Other reports.';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  select r.status into v_existing_status
  from public.self_received_requests r
  where r.player_id = v_player_id
    and r.self_item_id = v_item_id
    and r.slot is not distinct from nullif(p_slot, '')
    and r.track is not distinct from p_track
    and r.status in ('pending', 'approved')
  order by r.status
  limit 1;
  if v_existing_status = 'approved' then
    raise exception 'This item is already marked received% for this character.', v_track_label;
  elsif v_existing_status = 'pending' then
    raise exception 'You already reported this item%. It is waiting for an officer to review it.', v_track_label;
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.person_id = public.my_person_id() and tm.archived_at is null;
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  else
    -- Only a report an officer has to review goes to Discord.
    perform queue_discord_post(p_team_id, 'officer_requests', 'selfreceived', jsonb_build_object(
      'player', p_name_realm, 'item', p_item_name, 'slot', nullif(p_slot, ''),
      'source', nullif(p_source, ''), 'notes', nullif(p_note, '')));
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $function$;

CREATE OR REPLACE FUNCTION public.add_own_character(p_team_id integer, p_character_id integer, p_class_spec_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_person_id integer := public.my_person_id();
  v_member_id integer;
  v_member_archived boolean;
  v_character public.characters%rowtype;
  v_spec_class text;
  v_spec_label text;
  v_player_id integer;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null or v_person_id is null then
    raise exception 'Not signed in';
  end if;

  -- The membership first, the order every roster write takes (#1432), so this
  -- waits behind Archive Member instead of racing it. Stronger than the share
  -- hold the officers' writes take, so two of the caller's own adds (a double
  -- click, two tabs) queue too and the second finds the first's character.
  select tm.id, tm.archived_at is not null into v_member_id, v_member_archived
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = v_person_id
     for no key update;
  if v_member_id is null then
    raise exception 'You are not on this team';
  end if;
  if v_member_archived then
    raise exception 'Your place on this team has ended. Ask one of its officers to bring you back.';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select cs.class, concat_ws(' ', cs.class, cs.spec, cs.role)
    into v_spec_class, v_spec_label
    from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  if exists (
    select 1 from public.players p
     where p.team_id = p_team_id and p.team_member_id = v_member_id and p.archived_at is null
  ) then
    raise exception 'You already have a character on this team''s roster. Ask for a main swap instead.';
  end if;

  -- One statement for a new character and a returning one. A new one starts
  -- as a trial joining today. A returning one keeps its own trial flag, join
  -- date and history, as an officer's re-add does (restore_player()); the
  -- backup flags and the wishlist and BiS exceptions an officer set for its
  -- last stint do not carry over, as with the signup add and the invite link.
  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, team_member_id)
  values (p_team_id, v_character.name_realm, p_class_spec_id, true, v_today, v_member_id)
  on conflict (team_id, name_realm_key) do update
     set team_member_id = excluded.team_member_id,
         class_spec_id = excluded.class_spec_id,
         is_bench = false,
         is_backup_tank = false,
         is_backup_healer = false,
         wishlist_allowed = false,
         bis_allowed = false,
         archived_at = null
   -- Only a character off the roster, and never one someone else held here.
   where players.archived_at is not null
     and (players.team_member_id is null or players.team_member_id = excluded.team_member_id)
  returning id into v_player_id;

  if v_player_id is null then
    if exists (
      select 1 from public.players p
       where p.team_id = p_team_id and p.name_realm_key = v_character.name_realm_key and p.archived_at is null
    ) then
      raise exception '% is already on this roster', v_character.name_realm;
    end if;
    raise exception '% was someone else''s on this team. Ask one of its officers.', v_character.name_realm;
  end if;

  -- write_audit_log() is an officer's, so this writes its own row, as
  -- team_invite_link_join() does. Same action and detail shape as an
  -- officer's add, so both read alike in the Audit Log.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Player Added', 'players', v_player_id,
          to_jsonb(v_spec_label || ', added by the member'));

  perform queue_discord_post(p_team_id, 'officer_requests', 'addCharacter', jsonb_build_object(
    'member', coalesce((select n.label from public.names n where n.team_member_id = v_member_id limit 1), 'A member'),
    'nameRealm', v_character.name_realm, 'classSpec', v_spec_label));

  return v_player_id;
end;
$function$;

drop function public.my_recent_own_add(text);

-- The posting run, every minute. The local stack never fires it: seed.sql
-- deactivates every pg_cron job.
do $$
begin
  perform cron.unschedule('discord-post-queue');
exception when others then
  null;
end $$;

select cron.schedule(
  'discord-post-queue',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/discord-bot-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'optional_rsvp_reminders_secret')
    ),
    body := '{"action":"drain"}'::jsonb
  );
  $cron$
);
