-- #1535: each team's recruiting settings and its open spots, the database half
-- of recruiting on Raid Hub (#1551). The officers' Recruiting settings page
-- (#1548) writes them, and the public apply pages (#1546) read them.
--
-- What this adds:
--
-- * team_recruiting: one row per team, made when the team is (recruiting off,
--   the defaults below). Grouped the way the settings page groups it:
--   Recruiting, About the team, How you raid, What you ask for, the
--   exceptional players line, and Discord (what the bot does when someone
--   applies, #1541-#1544). The Discord part lives here rather than on
--   team_discord_config, which a team has only once it picks a server.
-- * team_recruiting_spots: the open spots, one row each. role is tank, healer,
--   melee or ranged: the apply page filters by those four, so an "Any" DPS
--   row needs melee or ranged, and a row with a spec takes the spec's own.
-- * edit_recruiting, a new team permission, on for Officers. The Team Owner
--   has every permission; Assistants don't edit recruiting (#1517).
-- * Four functions, the only way in:
--   team_recruiting_settings() reads one team's row and spots for its page,
--   save_team_recruiting() changes the fields it names,
--   set_team_recruiting_spots() replaces the spot list,
--   team_recruiting_page() is the apply pages' read, for anyone signed out.
--   The two writes add an audit row only when something changed.
--
-- The tables have no read rule for anyone signed in or out (#1286's rule for
-- a new table: a public page that shows guild data reads it through a
-- function that returns only what the page shows). team_recruiting_page()
-- also returns the team's raid nights and progress, so the apply pages keep
-- working when raid_schedule and team_raid_progress go to members only at
-- cutover (#1699), without those tables opening to anyone.
--
-- Turning taking_applications off changes nothing but this row: open
-- applications and trials (#1539) carry on.

-- Whether every item of a list matches a pattern, for the two list columns'
-- checks (a check can't hold a subquery). A list of lists, or a null item,
-- never matches (fresh-agent review).
create function public.text_items_match(p_items text[], p_pattern text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(array_ndims(p_items), 1) = 1
     and not exists (select 1 from unnest(p_items) as i where i is null or i !~ p_pattern);
$$;

create table public.team_recruiting (
  team_id integer primary key references public.teams(id) on delete cascade,

  -- Recruiting
  taking_applications boolean not null default false,
  join_method text not null default 'application'
    constraint team_recruiting_join_method check (join_method in ('application', 'discord_ticket')),
  ticket_link text
    constraint team_recruiting_ticket_link check (ticket_link ~ '^https://[^\s]+$' and char_length(ticket_link) <= 500),
  listed_on_guild_page boolean not null default true,

  -- About the team (Markdown)
  about text
    constraint team_recruiting_about check (char_length(about) <= 2000),

  -- How you raid. The nights themselves are raid_schedule's.
  schedule_note text
    constraint team_recruiting_schedule_note check (char_length(schedule_note) <= 100 and schedule_note !~ '[\r\n]'),
  extra_night text not null default 'none'
    constraint team_recruiting_extra_night check (extra_night in ('none', 'first_two_weeks', 'sometimes')),
  raid_languages text[] not null default '{}'
    constraint team_recruiting_raid_languages check (
      cardinality(raid_languages) <= 5 and public.text_items_match(raid_languages, '^(?=.*\S)[^\r\n|,;/]{1,30}$')
    ),
  split_runs text not null default 'none'
    constraint team_recruiting_split_runs check (split_runs in ('none', 'early_season', 'weekly')),
  alts_expected integer
    constraint team_recruiting_alts_expected check (alts_expected between 0 and 10),
  ptr_testing text not null default 'none'
    constraint team_recruiting_ptr_testing check (ptr_testing in ('none', 'optional', 'expected')),

  -- What you ask for
  min_item_level integer
    constraint team_recruiting_min_item_level check (min_item_level between 1 and 1000),
  attendance_percent integer
    constraint team_recruiting_attendance_percent check (attendance_percent between 1 and 100),
  trial_days integer not null default 14
    constraint team_recruiting_trial_days check (trial_days between 1 and 90),
  logs_required boolean not null default false,
  other_requirements text
    constraint team_recruiting_other_requirements check (char_length(other_requirements) <= 200 and other_requirements !~ '[\r\n]'),

  -- The exceptional players line, shown with the open spots, never instead
  exceptional_line_on boolean not null default false,
  exceptional_line text not null default 'Exceptional players of any class or spec are welcome to apply.'
    constraint team_recruiting_exceptional_line check (char_length(exceptional_line) <= 200 and exceptional_line ~ '\S' and exceptional_line !~ '[\r\n]'),

  -- Discord: what happens when someone applies
  discord_mode text not null default 'none'
    constraint team_recruiting_discord_mode check (discord_mode in ('ticket', 'officer_thread', 'officer_post', 'none')),
  officer_thread_with_ticket boolean not null default false,
  add_to_server boolean not null default false,
  ticket_category_id text
    constraint team_recruiting_ticket_category_id check (ticket_category_id ~ '^[0-9]{17,20}$'),
  visible_to_team_officers boolean not null default true,
  visible_to_team_assistants boolean not null default false,
  visible_to_guild_admins boolean not null default false,
  visible_to_role_ids text[] not null default '{}'
    constraint team_recruiting_visible_to_role_ids check (
      cardinality(visible_to_role_ids) <= 25 and public.text_items_match(visible_to_role_ids, '^[0-9]{17,20}$')
    ),

  -- Timings; empty means never
  dm_reply_after_minutes integer default 120
    constraint team_recruiting_dm_reply_after_minutes check (dm_reply_after_minutes between 1 and 10080),
  remind_after_hours integer default 48
    constraint team_recruiting_remind_after_hours check (remind_after_hours between 1 and 720),
  close_no_reply_after_hours integer default 120
    constraint team_recruiting_close_no_reply_after_hours check (close_no_reply_after_hours between 1 and 720),
  ping_officers_after_hours integer default 24
    constraint team_recruiting_ping_officers_after_hours check (ping_officers_after_hours between 1 and 720),
  ping_owner_after_hours integer default 72
    constraint team_recruiting_ping_owner_after_hours check (ping_owner_after_hours between 1 and 720),
  trial_end_notice_hours integer default 48
    constraint team_recruiting_trial_end_notice_hours check (trial_end_notice_hours between 1 and 720),
  delete_closed_after_hours integer default 24
    constraint team_recruiting_delete_closed_after_hours check (delete_closed_after_hours between 1 and 720),

  updated_at timestamp with time zone not null default now(),

  constraint team_recruiting_ticket_needs_link check (
    not taking_applications or join_method <> 'discord_ticket' or ticket_link is not null
  ),
  constraint team_recruiting_ticket_adds_to_server check (discord_mode <> 'ticket' or add_to_server),
  constraint team_recruiting_thread_with_ticket check (not officer_thread_with_ticket or discord_mode = 'ticket'),
  constraint team_recruiting_remind_before_close check (
    remind_after_hours is null or close_no_reply_after_hours is null
    or remind_after_hours < close_no_reply_after_hours
  ),
  constraint team_recruiting_owner_after_officers check (
    ping_officers_after_hours is null or ping_owner_after_hours is null
    or ping_officers_after_hours < ping_owner_after_hours
  )
);

comment on table public.team_recruiting is
  'A team''s recruiting settings, one row per team, made with the team (#1535): whether it takes applications and how people join, the apply page''s text, what it asks of applicants, and what the bot does in Discord when someone applies. Read and changed by the team''s officers through team_recruiting_settings() and save_team_recruiting(); the apply pages read it through team_recruiting_page(); the bot reads it with the service key.';
comment on column public.team_recruiting.taking_applications is
  'Off keeps everything else for next time; the apply page then says Not recruiting and still shows how the team raids. Open applications and trials carry on (#1535).';
comment on column public.team_recruiting.join_method is
  'application: the Raid Hub form. discord_ticket: no form; the apply page links to ticket_link, which must be set while taking applications.';
comment on column public.team_recruiting.listed_on_guild_page is
  'Off lets a team recruit quietly: its own apply link still works, it just is not listed with the guild''s other teams.';
comment on column public.team_recruiting.about is
  'About the team, light Markdown, up to 2,000 characters.';
comment on column public.team_recruiting.raid_languages is
  'The team''s raid languages in order, the first being the main one. Up to 5, each up to 30 characters.';
comment on column public.team_recruiting.alts_expected is
  'How many alts a raider is expected to keep; null hides the line.';
comment on column public.team_recruiting.exceptional_line_on is
  'Shows exceptional_line on the apply page in addition to the open spots, never instead of them.';
comment on column public.team_recruiting.discord_mode is
  'What the bot makes when someone applies: ticket (a private channel with the applicant and the officers), officer_thread (officers only), officer_post (one message in the officer channel) or none. ticket needs add_to_server.';
comment on column public.team_recruiting.officer_thread_with_ticket is
  'With a ticket, also open an officer-only thread about the applicant.';
comment on column public.team_recruiting.add_to_server is
  'Add the applicant to the team''s Discord server when they apply (#1540).';
comment on column public.team_recruiting.ticket_category_id is
  'The Discord category the bot makes tickets in.';
comment on column public.team_recruiting.visible_to_team_assistants is
  'Assistants see tickets and officer threads (the Assistant rank is #1517''s).';
comment on column public.team_recruiting.visible_to_guild_admins is
  'The guild''s Owner and Admins see tickets and officer threads.';
comment on column public.team_recruiting.visible_to_role_ids is
  'Extra Discord roles that see tickets and officer threads, such as a recruiter role. Up to 25, picked from the server (#994).';
comment on column public.team_recruiting.dm_reply_after_minutes is
  'DM the applicant this long after an officer''s unanswered message in their ticket. Null for never. The timings are the bot''s (#1543).';

create table public.team_recruiting_spots (
  id integer generated always as identity primary key,
  team_id integer not null references public.team_recruiting(team_id) on delete cascade,
  role text not null check (role in ('tank', 'healer', 'melee', 'ranged')),
  class_spec_id integer references public.classes_specs(id),
  priority text not null check (priority in ('high', 'medium', 'low')),
  sort_order integer not null
);

create unique index team_recruiting_spots_spec on public.team_recruiting_spots (team_id, class_spec_id)
  where class_spec_id is not null;
create unique index team_recruiting_spots_any on public.team_recruiting_spots (team_id, role)
  where class_spec_id is null;

comment on table public.team_recruiting_spots is
  'A team''s open spots (#1535), one row each, in sort_order. A spec, or no spec for Any tank, Any healer, Any melee or Any ranged. role matches the spec''s. Replaced as a list through set_team_recruiting_spots().';

alter table public.team_recruiting owner to postgres;
alter table public.team_recruiting enable row level security;
alter table public.team_recruiting_spots owner to postgres;
alter table public.team_recruiting_spots enable row level security;

create policy "Claude readers read team_recruiting" on public.team_recruiting
  for select to claude_readers using (true);
create policy "Claude readers read team_recruiting_spots" on public.team_recruiting_spots
  for select to claude_readers using (true);

-- Nobody reads or writes these directly: the functions run as their owner,
-- and the bot uses the service key.
revoke all on table public.team_recruiting from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_recruiting to service_role;
revoke all on table public.team_recruiting_spots from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_recruiting_spots to service_role;

-- A new team starts with recruiting off and the defaults, and off the guild's
-- apply page when it is unlisted.
create function public.seed_team_recruiting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into team_recruiting (team_id, listed_on_guild_page) values (new.id, not new.unlisted);
  return null;
end;
$$;

revoke all on function public.seed_team_recruiting() from public, anon, authenticated;

create trigger teams_seed_team_recruiting
  after insert on public.teams
  for each row execute function public.seed_team_recruiting();

-- An unlisted team (Wrathless) starts off the guild's apply page too, so its
-- settings say what visitors see (Kat, 2026-11-08). The page's read leaves
-- unlisted teams out of the list either way.
insert into public.team_recruiting (team_id, listed_on_guild_page)
select t.id, not t.unlisted from public.teams t;

-- WGA's teams at cutover: Phoenix and Hellfire Rollers take the form and open
-- a private ticket; Immolation and Wrathless send people to their own ticket.
-- All four stay off until the cutover turns them on.
update public.team_recruiting r
   set join_method = 'application', discord_mode = 'ticket', add_to_server = true
  from public.teams t join public.guilds g on g.id = t.guild_id
 where t.id = r.team_id and g.url_key = 'wga' and t.slug in ('phoenix', 'hellfire');
update public.team_recruiting r
   set join_method = 'discord_ticket'
  from public.teams t join public.guilds g on g.id = t.guild_id
 where t.id = r.team_id and g.url_key = 'wga' and t.slug in ('immolation', 'wrathless');

-- The grid row, last on the team grid, on for every team's Officers.
insert into public.rank_permissions (permission, scope, position, default_ranks)
values ('edit_recruiting', 'team', 15, '{officer}');

insert into public.team_rank_permissions (team_id, rank, permission)
select t.id, 'officer', 'edit_recruiting' from public.teams t;

-- One team's spots as the pages show them, in order. Called only from the
-- functions below, which run as the owner; nobody else may call it.
create function public.team_recruiting_spot_list(p_team_id integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'role', s.role,
           'class_spec_id', s.class_spec_id,
           'class', cs.class,
           'spec', cs.spec,
           'priority', s.priority) order by s.sort_order, s.id), '[]'::jsonb)
    from team_recruiting_spots s
    left join classes_specs cs on cs.id = s.class_spec_id
   where s.team_id = p_team_id;
$$;

revoke all on function public.team_recruiting_spot_list(integer) from public, anon, authenticated;

-- Everything the Recruiting settings page shows: every column of the row
-- except team_id, and the spots.
create function public.team_recruiting_settings(p_team_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row team_recruiting;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_row from team_recruiting r where r.team_id = p_team_id;
  if not found then
    raise exception 'That team does not exist';
  end if;

  return (to_jsonb(v_row) - 'team_id')
         || jsonb_build_object('spots', team_recruiting_spot_list(p_team_id));
end;
$$;

comment on function public.team_recruiting_settings(integer) is
  'A team''s recruiting settings and open spots for its Recruiting settings page (#1535): every column of team_recruiting but team_id, plus spots. For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.team_recruiting_settings(integer) from public, anon;
grant execute on function public.team_recruiting_settings(integer) to authenticated;

-- p_changes is an object of column names to new values, e.g.
-- {"taking_applications": true, "trial_days": 21}. A column it doesn't name
-- stays as it is, so each section of the page saves only its own fields. A
-- name that isn't a setting is refused, and so is a value a constraint
-- refuses (the error names the constraint).
create function public.save_team_recruiting(p_team_id integer, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old team_recruiting;
  v_new team_recruiting;
  v_bad text;
  v_detail jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Changes must be an object of settings';
  end if;

  select * into v_old from team_recruiting r where r.team_id = p_team_id for update;
  if not found then
    raise exception 'That team does not exist';
  end if;

  select k into v_bad
    from jsonb_object_keys(p_changes) as k
   where k in ('team_id', 'updated_at') or not (to_jsonb(v_old) ? k)
   limit 1;
  if v_bad is not null then
    raise exception 'That is not a recruiting setting: %', v_bad;
  end if;

  v_new := jsonb_populate_record(v_old, p_changes);

  select jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', to_jsonb(v_new) -> o.key))
    into v_detail
    from jsonb_each(to_jsonb(v_old)) o
   where o.key <> 'updated_at' and o.value is distinct from to_jsonb(v_new) -> o.key;

  -- Nothing actually changed: nothing to write or log.
  if v_detail is null then
    return;
  end if;

  update team_recruiting r
     set taking_applications = v_new.taking_applications,
         join_method = v_new.join_method,
         ticket_link = v_new.ticket_link,
         listed_on_guild_page = v_new.listed_on_guild_page,
         about = v_new.about,
         schedule_note = v_new.schedule_note,
         extra_night = v_new.extra_night,
         raid_languages = v_new.raid_languages,
         split_runs = v_new.split_runs,
         alts_expected = v_new.alts_expected,
         ptr_testing = v_new.ptr_testing,
         min_item_level = v_new.min_item_level,
         attendance_percent = v_new.attendance_percent,
         trial_days = v_new.trial_days,
         logs_required = v_new.logs_required,
         other_requirements = v_new.other_requirements,
         exceptional_line_on = v_new.exceptional_line_on,
         exceptional_line = v_new.exceptional_line,
         discord_mode = v_new.discord_mode,
         officer_thread_with_ticket = v_new.officer_thread_with_ticket,
         add_to_server = v_new.add_to_server,
         ticket_category_id = v_new.ticket_category_id,
         visible_to_team_officers = v_new.visible_to_team_officers,
         visible_to_team_assistants = v_new.visible_to_team_assistants,
         visible_to_guild_admins = v_new.visible_to_guild_admins,
         visible_to_role_ids = v_new.visible_to_role_ids,
         dm_reply_after_minutes = v_new.dm_reply_after_minutes,
         remind_after_hours = v_new.remind_after_hours,
         close_no_reply_after_hours = v_new.close_no_reply_after_hours,
         ping_officers_after_hours = v_new.ping_officers_after_hours,
         ping_owner_after_hours = v_new.ping_owner_after_hours,
         trial_end_notice_hours = v_new.trial_end_notice_hours,
         delete_closed_after_hours = v_new.delete_closed_after_hours,
         updated_at = now()
   where r.team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Recruiting Settings Changed', 'teams', p_team_id, v_detail);
end;
$$;

comment on function public.save_team_recruiting(integer, jsonb) is
  'Changes the recruiting settings p_changes names (#1535), leaving the rest as they are, and logs each changed field''s from and to. For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.save_team_recruiting(integer, jsonb) from public, anon;
grant execute on function public.save_team_recruiting(integer, jsonb) to authenticated;

-- p_spots is the whole list in order, e.g.
-- [{"class_spec_id": 12, "priority": "high"}, {"role": "ranged", "priority": "low"}].
-- A spot with a spec takes the spec's role (a role sent with it must match);
-- a spot without one needs a role. The same spec twice, or two Any rows for
-- one role, is refused. Up to 40.
create function public.set_team_recruiting_spots(p_team_id integer, p_spots jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_spot jsonb;
  v_n integer := 0;
  v_spec integer;
  v_role text;
  v_spec_role text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_spots) is distinct from 'array' then
    raise exception 'Spots must be a list';
  end if;
  if jsonb_array_length(p_spots) > 40 then
    raise exception 'A team has at most 40 open spots';
  end if;
  perform 1 from team_recruiting r where r.team_id = p_team_id for update;
  if not found then
    raise exception 'That team does not exist';
  end if;

  v_old := team_recruiting_spot_list(p_team_id);
  delete from team_recruiting_spots where team_id = p_team_id;

  for v_spot in select value from jsonb_array_elements(p_spots)
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_spot) is distinct from 'object' then
      raise exception 'Each spot must be an object';
    end if;
    -- A mistyped key would otherwise save an Any spot (fresh-agent review).
    if exists (select 1 from jsonb_object_keys(v_spot) as k
                where k not in ('role', 'class_spec_id', 'priority')) then
      raise exception 'A spot has only role, class_spec_id and priority';
    end if;
    if v_spot ->> 'priority' is null or v_spot ->> 'priority' not in ('high', 'medium', 'low') then
      raise exception 'A spot''s priority is high, medium or low';
    end if;
    v_spec := (v_spot ->> 'class_spec_id')::integer;
    v_role := v_spot ->> 'role';
    if v_spec is not null then
      select case cs.role when 'Tank' then 'tank' when 'Heal' then 'healer'
                          when 'Melee' then 'melee' when 'Ranged' then 'ranged' end
        into v_spec_role
        from classes_specs cs where cs.id = v_spec;
      if v_spec_role is null then
        raise exception 'That is not a spec';
      end if;
      if v_role is not null and v_role <> v_spec_role then
        raise exception 'That spec is a % spec', v_spec_role;
      end if;
      v_role := v_spec_role;
    elsif v_role is null or v_role not in ('tank', 'healer', 'melee', 'ranged') then
      raise exception 'A spot without a spec needs tank, healer, melee or ranged';
    end if;

    begin
      insert into team_recruiting_spots (team_id, role, class_spec_id, priority, sort_order)
      values (p_team_id, v_role, v_spec, v_spot ->> 'priority', v_n);
    exception when unique_violation then
      raise exception 'That spot is on the list twice';
    end;
  end loop;

  if team_recruiting_spot_list(p_team_id) = v_old then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Recruiting Spots Changed', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', team_recruiting_spot_list(p_team_id)));
end;
$$;

comment on function public.set_team_recruiting_spots(integer, jsonb) is
  'Replaces a team''s open spots with p_spots, in order (#1535): each a class_spec_id or an Any role, and a priority. All of a save applies or none of it; logged when the list changed. For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.set_team_recruiting_spots(integer, jsonb) from public, anon;
grant execute on function public.set_team_recruiting_spots(integer, jsonb) to authenticated;

-- The apply pages' read, for anyone, signed out included. With p_team_key,
-- that one team when it is taking applications or listed (its own link works
-- while unlisted); without, the guild's listed teams, for the guild's apply
-- page. Archived teams, and teams kept off the guild's pages, never show in
-- the list. Each team comes with its open spots, weekly raid nights and boss
-- progress, and none of the Discord settings, which are the officers' and
-- the bot's.
create function public.team_recruiting_page(p_guild_key text, p_team_key text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id', t.id,
           'name', t.name,
           'slug', t.slug,
           'taking_applications', r.taking_applications,
           'join_method', r.join_method,
           'ticket_link', r.ticket_link,
           'about', r.about,
           'schedule_note', r.schedule_note,
           'extra_night', r.extra_night,
           'raid_languages', r.raid_languages,
           'split_runs', r.split_runs,
           'alts_expected', r.alts_expected,
           'ptr_testing', r.ptr_testing,
           'min_item_level', r.min_item_level,
           'attendance_percent', r.attendance_percent,
           'trial_days', r.trial_days,
           'logs_required', r.logs_required,
           'other_requirements', r.other_requirements,
           'exceptional_line', case when r.exceptional_line_on then r.exceptional_line end,
           'spots', team_recruiting_spot_list(t.id),
           'nights', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'weekday', s.weekday,
                      'start_time', s.start_time,
                      'timezone', s.timezone,
                      'duration_minutes', s.duration_minutes,
                      'is_optional', s.is_optional,
                      'difficulty', s.difficulty) order by s.weekday, s.start_time)
               from raid_schedule s
              where s.team_id = t.id and s.active), '[]'::jsonb),
           'progress', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'zone', z.name,
                      'season', z.season,
                      'boss', e.name,
                      'mythic_date', p.mythic_date,
                      'mythic_best_pct', p.mythic_best_pct,
                      'heroic_date', p.heroic_date,
                      'heroic_best_pct', p.heroic_best_pct) order by z.sort_index, z.id, e.sort_index, e.id)
               from team_raid_progress p
               join raid_encounters e on e.id = p.encounter_id
               join raid_zones z on z.id = e.zone_id
              where p.team_id = t.id), '[]'::jsonb)
         ) order by t.name), '[]'::jsonb)
    from guilds g
    join teams t on t.guild_id = g.id and t.archived_at is null
    join team_recruiting r on r.team_id = t.id
   where g.url_key = p_guild_key
     and case when p_team_key is null
              then r.listed_on_guild_page and not t.unlisted
              else t.slug = p_team_key and (r.taking_applications or r.listed_on_guild_page)
         end;
$$;

comment on function public.team_recruiting_page(text, text) is
  'The apply pages'' read (#1535, #1546), for anyone, signed out included: with p_team_key that team if it is taking applications or listed, otherwise the guild''s listed teams. A list of teams, each with its public settings, open spots, weekly raid nights and boss progress; no Discord settings. Empty when nothing matches.';

revoke all on function public.team_recruiting_page(text, text) from public;
grant execute on function public.team_recruiting_page(text, text) to anon, authenticated;
