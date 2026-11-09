-- #1539: recruit records, the database half (#1551). Every person who applies
-- to a team, or whom an officer adds from a Discord ticket, gets a record that
-- outlives the ticket channel. The trial actions (start, extend, joined, not
-- joining) and their roster changes are #1793; this adds the trial columns
-- they fill.
--
-- What this adds:
--
-- * recruit_applications: one per person per team per attempt. The character
--   applied with and a copy of its numbers at send time (#1538 fills the
--   numbers this can't read), the answers with a copy of each question's
--   wording, who sent them, the applicant's time zone, where it stands, the
--   time each side last wrote in the ticket, trial dates, and the Discord ids
--   the bot made. One open at a time per person per team.
-- * recruit_notes: officers' notes, from Raid Hub or a Discord button. Never
--   shown to the applicant.
-- * recruit_events: the record's history, one row per thing that happened.
-- * recruit_messages: a closed ticket's conversation, saved by the bot before
--   the channel goes. Attachments keep their name and type only: Discord's
--   links expire, and nothing is copied to Storage (Kat, 2026-11-09).
-- * recruit_reminders_sent: which reminders went out, so the bot's sweep never
--   sends one twice.
-- * Functions, the only way in for the site. The bot uses the service key: it
--   writes the Discord ids, last-message times, history, conversation and
--   reminders directly, and calls bot_* versions of the officer actions, which
--   take the Discord id of the person who pressed the button once the bot has
--   checked they may.
--
-- Who sees a team's records is recruit_access(): the team's edit_recruiting
-- holders and site admins manage them; its assistants add notes when the team
-- lets assistants see tickets; the guild's Owner and Admins read them when the
-- team lets them, as does anyone who sees every team. The recruiter who sent
-- someone reads a short record and their own notes. The application-pictures
-- bucket follows the same rule now.
--
-- Everything is kept for now, closed records and conversations too; deletion
-- is #1527's.

create table public.recruit_applications (
  id integer generated always as identity primary key,
  team_id integer not null references public.team_recruiting(team_id) on delete cascade,
  person_id integer references public.people(id) on delete set null,
  source text not null
    constraint recruit_applications_source check (source in ('application', 'added_by_officer')),
  status text not null default 'waiting_on_officers'
    constraint recruit_applications_status check (status in (
      'waiting_on_officers', 'waiting_on_applicant', 'on_trial',
      'joined', 'declined', 'not_joining', 'no_reply', 'withdrawn')),
  -- The character, and a copy of its numbers when sent.
  character_id integer references public.characters(id) on delete set null,
  name_realm text not null
    constraint recruit_applications_name_realm check (char_length(name_realm) <= 100 and name_realm ~ '^[^\s-][^-]*-\S' and name_realm !~ '[\r\n]'),
  class_name text
    constraint recruit_applications_class_name check (char_length(class_name) <= 30),
  spec_name text
    constraint recruit_applications_spec_name check (char_length(spec_name) <= 30),
  other_specs text[] not null default '{}'
    constraint recruit_applications_other_specs check (cardinality(other_specs) <= 4 and public.text_items_match(other_specs, '^[^\r\n]{1,30}$')),
  item_level integer
    constraint recruit_applications_item_level check (item_level between 1 and 1000),
  mplus_score numeric(6, 1)
    constraint recruit_applications_mplus_score check (mplus_score >= 0),
  logs_best_average numeric(4, 1)
    constraint recruit_applications_logs_best_average check (logs_best_average between 0 and 100),
  logs_median_average numeric(4, 1)
    constraint recruit_applications_logs_median_average check (logs_median_average between 0 and 100),
  mythic_bosses_killed integer
    constraint recruit_applications_mythic_bosses_killed check (mythic_bosses_killed >= 0),
  answers jsonb not null default '[]'
    constraint recruit_applications_answers check (jsonb_typeof(answers) = 'array'),
  -- Who sent them. A recruiter keeps their code and name as well as the
  -- person, since guild_recruiters rows go when the person does.
  sent_by text not null default 'nobody'
    constraint recruit_applications_sent_by check (sent_by in ('recruiter', 'friend', 'nobody')),
  recruiter_person_id integer references public.people(id) on delete set null,
  recruiter_code text
    constraint recruit_applications_recruiter_code check (recruiter_code ~ '^[a-z0-9]{8}$'),
  sent_by_name text
    constraint recruit_applications_sent_by_name check (char_length(sent_by_name) <= 100 and sent_by_name ~ '\S' and sent_by_name !~ '[\r\n]'),
  time_zone text
    constraint recruit_applications_time_zone check (char_length(time_zone) <= 64),
  applicant_last_message_at timestamptz,
  officers_last_message_at timestamptz,
  trial_starts_on date,
  trial_ends_on date,
  discord_channel_id text
    constraint recruit_applications_discord_channel_id check (discord_channel_id ~ '^[0-9]{17,20}$'),
  discord_thread_id text
    constraint recruit_applications_discord_thread_id check (discord_thread_id ~ '^[0-9]{17,20}$'),
  discord_officer_message_id text
    constraint recruit_applications_discord_officer_message_id check (discord_officer_message_id ~ '^[0-9]{17,20}$'),
  applied_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint recruit_applications_sent_by_shape check (coalesce(
    case sent_by
      when 'recruiter' then recruiter_code is not null and sent_by_name is not null
      when 'friend' then sent_by_name is not null and recruiter_code is null and recruiter_person_id is null
      else sent_by_name is null and recruiter_code is null and recruiter_person_id is null
    end, false)),
  constraint recruit_applications_trial_dates check (
    (trial_starts_on is null) = (trial_ends_on is null) and coalesce(trial_ends_on >= trial_starts_on, true)),
  constraint recruit_applications_on_trial_dated check (status <> 'on_trial' or trial_ends_on is not null),
  constraint recruit_applications_closed check (
    (status in ('joined', 'declined', 'not_joining', 'no_reply', 'withdrawn')) = (closed_at is not null))
);

create unique index recruit_applications_one_open on public.recruit_applications (team_id, person_id) where closed_at is null;
create index recruit_applications_team on public.recruit_applications (team_id, applied_at desc);
create index recruit_applications_person on public.recruit_applications (person_id);
create index recruit_applications_recruiter on public.recruit_applications (recruiter_person_id);

comment on table public.recruit_applications is
  'Recruit records (#1539): one per person per team per attempt, sent from the form (source application) or added by an officer for a ticket-only applicant (added_by_officer). The character columns are a copy taken when sent. One open (closed_at null) per person per team. Read and written through functions; the bot writes the Discord ids and last-message times with the service key.';
comment on column public.recruit_applications.answers is
  'The answers in form order, each {key or question_id, label, prompt, answer_type, answer}, with the question''s wording as it was when sent. A picture answer is its path in the application-pictures bucket.';
comment on column public.recruit_applications.status is
  'waiting_on_officers and waiting_on_applicant follow the last-message times (recruit_applications_whose_turn); on_trial, joined and not_joining are #1793''s; declined, no_reply and withdrawn close it.';
comment on column public.recruit_applications.time_zone is
  'The applicant''s time zone, from their browser, so reminders never DM them overnight.';

-- An open record's waiting_on_* follows whoever wrote last: officers last,
-- the applicant's turn; otherwise the officers'. The bot only sets the times.
create function public.recruit_applications_whose_turn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('waiting_on_officers', 'waiting_on_applicant') then
    new.status := case when new.officers_last_message_at > coalesce(new.applicant_last_message_at, '-infinity')
                       then 'waiting_on_applicant' else 'waiting_on_officers' end;
  end if;
  return new;
end;
$$;

revoke all on function public.recruit_applications_whose_turn() from public, anon, authenticated;

create trigger recruit_applications_whose_turn
  before insert or update of status, applicant_last_message_at, officers_last_message_at on public.recruit_applications
  for each row execute function public.recruit_applications_whose_turn();

create table public.recruit_notes (
  id integer generated always as identity primary key,
  application_id integer not null references public.recruit_applications(id) on delete cascade,
  author_person_id integer references public.people(id) on delete set null,
  source text not null
    constraint recruit_notes_source check (source in ('site', 'discord')),
  body text not null
    constraint recruit_notes_body check (char_length(body) <= 2000 and body ~ '\S'),
  created_at timestamptz not null default now()
);

create index recruit_notes_application on public.recruit_notes (application_id, created_at);

comment on table public.recruit_notes is
  'Notes on a recruit record (#1539), from Raid Hub (site) or a Discord button (discord). Never shown to the applicant; the recruiter who sent the person sees only their own.';

create table public.recruit_events (
  id integer generated always as identity primary key,
  application_id integer not null references public.recruit_applications(id) on delete cascade,
  kind text not null
    constraint recruit_events_kind check (kind in (
      'applied', 'added_by_officer', 'withdrawn', 'joined_discord', 'ticket_opened', 'officer_replied',
      'reminder_sent', 'trial_started', 'trial_extended', 'declined', 'joined', 'not_joining',
      'closed', 'reopened', 'note_added')),
  actor_person_id integer references public.people(id) on delete set null,
  detail text
    constraint recruit_events_detail check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

create index recruit_events_application on public.recruit_events (application_id, created_at);

comment on table public.recruit_events is
  'A recruit record''s history (#1539), for its What''s happened list: who did what, when, and a short detail (a decline or extension reason, which reminder). The functions and the bot write it.';

create table public.recruit_messages (
  id integer generated always as identity primary key,
  application_id integer not null references public.recruit_applications(id) on delete cascade,
  discord_message_id text not null
    constraint recruit_messages_discord_message_id check (discord_message_id ~ '^[0-9]{17,20}$'),
  author_discord_id text
    constraint recruit_messages_author_discord_id check (author_discord_id ~ '^[0-9]{17,20}$'),
  author_name text not null
    constraint recruit_messages_author_name check (char_length(author_name) <= 100),
  body text not null default ''
    constraint recruit_messages_body check (char_length(body) <= 4000),
  attachments jsonb not null default '[]'
    constraint recruit_messages_attachments check (jsonb_typeof(attachments) = 'array'),
  sent_at timestamptz not null,
  unique (application_id, discord_message_id)
);

create index recruit_messages_application on public.recruit_messages (application_id, sent_at);

comment on table public.recruit_messages is
  'A closed ticket''s conversation (#1539), saved by the bot before the channel is deleted. attachments is a list of {name, content_type}: the files themselves are not kept, since Discord''s links expire.';

create table public.recruit_reminders_sent (
  id integer generated always as identity primary key,
  application_id integer not null references public.recruit_applications(id) on delete cascade,
  reminder text not null
    constraint recruit_reminders_sent_reminder check (reminder ~ '^[a-z_]{1,40}$'),
  due_for timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (application_id, reminder, due_for)
);

comment on table public.recruit_reminders_sent is
  'Which recruiting reminders the bot sent (#1539, #1543), the shape of raid_rsvp_reminders_sent. due_for is the message time or trial end the reminder was for, so a new message starts a new round and a repeat sweep sends nothing twice.';

alter table public.recruit_applications owner to postgres;
alter table public.recruit_applications enable row level security;
alter table public.recruit_notes owner to postgres;
alter table public.recruit_notes enable row level security;
alter table public.recruit_events owner to postgres;
alter table public.recruit_events enable row level security;
alter table public.recruit_messages owner to postgres;
alter table public.recruit_messages enable row level security;
alter table public.recruit_reminders_sent owner to postgres;
alter table public.recruit_reminders_sent enable row level security;

create policy "Claude readers read recruit_applications" on public.recruit_applications
  for select to claude_readers using (true);
create policy "Claude readers read recruit_notes" on public.recruit_notes
  for select to claude_readers using (true);
create policy "Claude readers read recruit_events" on public.recruit_events
  for select to claude_readers using (true);
create policy "Claude readers read recruit_messages" on public.recruit_messages
  for select to claude_readers using (true);
create policy "Claude readers read recruit_reminders_sent" on public.recruit_reminders_sent
  for select to claude_readers using (true);

-- Nobody reads or writes these directly from the site: the functions run as
-- their owner, and the bot uses the service key.
revoke all on table public.recruit_applications from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recruit_applications to service_role;
revoke all on table public.recruit_notes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recruit_notes to service_role;
revoke all on table public.recruit_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recruit_events to service_role;
revoke all on table public.recruit_messages from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recruit_messages to service_role;
revoke all on table public.recruit_reminders_sent from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recruit_reminders_sent to service_role;

-- What the caller may do with a team's recruit records: 'manage' (the team's
-- edit_recruiting holders, site admins), 'note' (its assistants, when the
-- team lets assistants see tickets), 'read' (the guild's Owner and Admins
-- when the team lets them, and anyone who sees every team), or null.
create function public.recruit_access(p_team_id integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin() then 'manage'
    when exists (select 1 from team_recruiting r
                   join team_members m on m.team_id = r.team_id
                  where r.team_id = p_team_id and r.visible_to_team_assistants
                    and m.person_id = my_person_id() and m.archived_at is null and m.rank = 'assistant') then 'note'
    when exists (select 1 from team_recruiting r
                   join teams t on t.id = r.team_id
                  where r.team_id = p_team_id
                    and ((r.visible_to_guild_admins
                          and exists (select 1 from guild_ranks g
                                       where g.guild_id = t.guild_id and g.person_id = my_person_id()
                                         and g.rank in ('owner', 'admin')))
                         or has_guild_permission(t.guild_id, 'view_every_team'))) then 'read'
  end;
$$;

comment on function public.recruit_access(integer) is
  'What the caller may do with a team''s recruit records (#1539): manage (edit_recruiting, site admins), note (assistants, when visible_to_team_assistants), read (the guild''s Owner and Admins when visible_to_guild_admins, and view_every_team), or null.';

revoke all on function public.recruit_access(integer) from public, anon;
grant execute on function public.recruit_access(integer) to authenticated;

-- An audit row for a recruit action, in the acting person's name.
create function public.recruit_log(p_team_id integer, p_actor integer, p_action text, p_application_id integer, p_detail jsonb)
returns void
language sql
set search_path = public
as $$
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, (select auth_user_id from people where id = p_actor), p_action,
          'recruit_applications', p_application_id, p_detail);
$$;

revoke all on function public.recruit_log(integer, integer, text, integer, jsonb) from public, anon, authenticated;

-- An open record of a team that isn't archived, locked for the change; the
-- team row's share lock holds off an archive until it commits.
create function public.recruit_lock(p_application_id integer)
returns public.recruit_applications
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
begin
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found then
    raise exception 'That recruit does not exist';
  end if;
  perform 1 from teams t where t.id = v_app.team_id and t.archived_at is null for share;
  if not found then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  return v_app;
end;
$$;

revoke all on function public.recruit_lock(integer) from public, anon, authenticated;

-- The shared actions, for the site's functions and the bot's. The caller has
-- checked that p_actor may.
create function public.recruit_add_note(p_application_id integer, p_actor integer, p_source text, p_body text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_id integer;
begin
  perform recruit_lock(p_application_id);
  insert into recruit_notes (application_id, author_person_id, source, body)
  values (p_application_id, p_actor, p_source, btrim(p_body))
  returning id into v_id;
  insert into recruit_events (application_id, kind, actor_person_id)
  values (p_application_id, 'note_added', p_actor);
  return v_id;
end;
$$;

revoke all on function public.recruit_add_note(integer, integer, text, text) from public, anon, authenticated;

-- Declined or no reply. Ending a trial is #1793's, so an on-trial record is
-- refused.
create function public.recruit_close(p_application_id integer, p_actor integer, p_status text, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_status is null or p_status not in ('declined', 'no_reply') then
    raise exception 'A recruit is closed as declined or no_reply';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id);
  if v_app.closed_at is not null then
    raise exception 'That recruit is already closed';
  end if;
  if v_app.status = 'on_trial' then
    raise exception 'That recruit is on trial: end the trial instead';
  end if;
  update recruit_applications set status = p_status, closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, case p_status when 'declined' then 'declined' else 'closed' end, p_actor,
          case p_status when 'declined' then v_reason else concat_ws(': ', 'No reply', v_reason) end);
  perform recruit_log(v_app.team_id, p_actor,
                      case p_status when 'declined' then 'Recruit Declined' else 'Recruit Closed' end,
                      p_application_id, jsonb_build_object('name_realm', v_app.name_realm, 'reason', v_reason));
end;
$$;

revoke all on function public.recruit_close(integer, integer, text, text) from public, anon, authenticated;

-- Back open, whose turn it is by the last-message times.
create function public.recruit_reopen(p_application_id integer, p_actor integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
begin
  v_app := recruit_lock(p_application_id);
  if v_app.status not in ('declined', 'no_reply') then
    raise exception 'Only a declined or no-reply recruit can be reopened';
  end if;
  if exists (select 1 from recruit_applications a
              where a.team_id = v_app.team_id and a.person_id = v_app.person_id and a.closed_at is null) then
    raise exception 'That person has another open application with this team';
  end if;
  update recruit_applications set status = 'waiting_on_officers', closed_at = null where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'reopened', p_actor);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Reopened', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm));
end;
$$;

revoke all on function public.recruit_reopen(integer, integer) from public, anon, authenticated;

-- Sends an application. p_answers is an object keyed by a starter question's
-- key or a team question's id: {"about": "Healer, ten years", "12": true}.
-- Only questions that are on; every required one answered. p_recruiter_code
-- (from the ?from= link or the Who sent you? pick) or p_friend_name, not both.
create function public.send_application(
  p_team_id integer, p_character_id integer, p_answers jsonb,
  p_recruiter_code text, p_friend_name text, p_time_zone text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_me integer := my_person_id();
  v_guild integer;
  v_char characters;
  v_form jsonb;
  v_q jsonb;
  v_key text;
  v_a jsonb;
  v_text text;
  v_answers jsonb := '[]'::jsonb;
  v_sent_by text := 'nobody';
  v_recruiter integer;
  v_code text;
  v_sent_name text;
  v_friend text := nullif(btrim(p_friend_name), '');
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from people where id = v_me and discord_id is not null) then
    raise exception 'Link your Discord account before applying';
  end if;
  select * into v_char from characters where id = p_character_id and person_id = v_me;
  if not found then
    raise exception 'That character is not one of yours';
  end if;
  select t.guild_id into v_guild from teams t where t.id = p_team_id and t.archived_at is null for share;
  perform 1 from team_recruiting r
   where r.team_id = p_team_id and r.taking_applications and r.join_method = 'application' and v_guild is not null
     for share;
  if not found then
    raise exception 'That team isn''t taking applications';
  end if;
  if exists (select 1 from recruit_applications a
              where a.team_id = p_team_id and a.person_id = v_me and a.closed_at is null) then
    raise exception 'You already have an open application with this team';
  end if;
  if p_time_zone is not null and not exists (select 1 from pg_timezone_names z where z.name = p_time_zone) then
    raise exception 'That is not a time zone';
  end if;

  -- Who sent them. A code is checked here, never trusted from the browser.
  if p_recruiter_code is not null and v_friend is not null then
    raise exception 'A recruiter or a friend sent you, not both';
  elsif p_recruiter_code is not null then
    select r.person_id, r.code, coalesce(guild_person_public_name(r.guild_id, r.person_id), 'A recruiter')
      into v_recruiter, v_code, v_sent_name
      from guild_recruiters r
     where r.guild_id = v_guild and r.code = lower(p_recruiter_code) and r.active and in_guild(r.guild_id, r.person_id);
    if not found then
      raise exception 'That recruiter link isn''t active';
    end if;
    v_sent_by := 'recruiter';
  elsif v_friend is not null then
    if char_length(v_friend) > 100 or v_friend ~ '[\r\n]' then
      raise exception 'A friend''s name is one line of at most 100 characters';
    end if;
    v_sent_by := 'friend';
    v_sent_name := v_friend;
  end if;

  -- The answers, against the questions that are on now.
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers must be an object';
  end if;
  v_form := team_application_question_list(p_team_id);
  for v_q in
    select q from (
      select s || jsonb_build_object('akey', s ->> 'key') as q, 1 as part, o
        from jsonb_array_elements(v_form -> 'starters') with ordinality as e(s, o)
       where (s ->> 'on')::boolean and s ->> 'answer_type' <> 'recruiter'
      union all
      select s || jsonb_build_object('akey', s ->> 'id'), 2, o
        from jsonb_array_elements(v_form -> 'questions') with ordinality as e(s, o)
    ) x
    order by part, o
  loop
    v_key := v_q ->> 'akey';
    v_a := p_answers -> v_key;
    if v_a is null or v_a = 'null'::jsonb or (jsonb_typeof(v_a) = 'string' and btrim(v_a #>> '{}') = '') then
      if (v_q ->> 'required')::boolean then
        raise exception 'Please answer: %', v_q ->> 'prompt';
      end if;
      continue;
    end if;
    v_text := case when jsonb_typeof(v_a) = 'string' then v_a #>> '{}' end;
    if v_q ->> 'answer_type' = 'yes_no' then
      if jsonb_typeof(v_a) <> 'boolean' then
        raise exception 'Answer yes or no: %', v_q ->> 'prompt';
      end if;
    elsif v_text is null then
      raise exception 'That answer must be text: %', v_q ->> 'prompt';
    elsif v_q ->> 'answer_type' in ('short_text', 'paragraph') then
      v_text := btrim(v_text);
      if char_length(v_text) > (v_q ->> 'max_length')::integer then
        raise exception 'That answer is over % characters: %', v_q ->> 'max_length', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'link' then
      v_text := btrim(v_text);
      if v_text !~ '^https?://\S+$' or char_length(v_text) > 500 then
        raise exception 'That answer must be a link: %', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'choice' then
      if not (v_q -> 'choices') ? v_text then
        raise exception 'That is not one of the choices: %', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'picture' then
      if not starts_with(v_text, p_team_id || '/' || v_uid || '/')
         or not exists (select 1 from storage.objects o
                         where o.bucket_id = 'application-pictures' and o.name = v_text) then
        raise exception 'That picture is not one you uploaded for this team: %', v_q ->> 'prompt';
      end if;
    end if;
    v_answers := v_answers || jsonb_build_array(
      case when v_q ? 'key' then jsonb_build_object('key', v_q ->> 'key')
           else jsonb_build_object('question_id', (v_q ->> 'id')::integer) end
      || jsonb_build_object('label', v_q ->> 'label', 'prompt', v_q ->> 'prompt',
                            'answer_type', v_q ->> 'answer_type',
                            'answer', case when v_text is null then v_a else to_jsonb(v_text) end));
  end loop;
  if exists (select 1 from jsonb_object_keys(p_answers) as k
              where k not in (select a ->> 'key' from jsonb_array_elements(v_answers) a where a ? 'key'
                              union all
                              select a ->> 'question_id' from jsonb_array_elements(v_answers) a where a ? 'question_id')
                and (p_answers -> k) <> 'null'::jsonb
                and not (jsonb_typeof(p_answers -> k) = 'string' and btrim(p_answers ->> k) = '')) then
    raise exception 'An answer is for a question that is not on this form';
  end if;

  insert into recruit_applications (
    team_id, person_id, source, character_id, name_realm, class_name, spec_name, item_level,
    answers, sent_by, recruiter_person_id, recruiter_code, sent_by_name, time_zone)
  values (p_team_id, v_me, 'application', v_char.id, v_char.name_realm, v_char.class_name, v_char.spec_name,
          v_char.item_level, v_answers, v_sent_by, v_recruiter, v_code, v_sent_name, p_time_zone)
  returning id into v_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (v_id, 'applied', v_me);
  perform recruit_log(p_team_id, v_me, 'Application Sent', v_id, jsonb_build_object('name_realm', v_char.name_realm));
  return v_id;
end;
$$;

comment on function public.send_application(integer, integer, jsonb, text, text, text) is
  'Sends an application (#1539, #1547) with one of the caller''s characters, while the team takes applications through the form. p_answers is keyed by starter key or team question id; only questions that are on, every required one answered. p_recruiter_code is checked against the guild''s active recruiters. One open application per person per team. Needs a linked Discord account.';

revoke all on function public.send_application(integer, integer, jsonb, text, text, text) from public, anon;
grant execute on function public.send_application(integer, integer, jsonb, text, text, text) to authenticated;

create function public.withdraw_application(p_application_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
  v_app recruit_applications;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found or v_app.person_id is distinct from v_me then
    raise exception 'That application is not yours';
  end if;
  if v_app.closed_at is not null then
    raise exception 'That application is already closed';
  end if;
  if v_app.status = 'on_trial' then
    raise exception 'You''re on trial: ask the officers to end it';
  end if;
  update recruit_applications set status = 'withdrawn', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'withdrawn', v_me);
  perform recruit_log(v_app.team_id, v_me, 'Application Withdrawn', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm));
end;
$$;

comment on function public.withdraw_application(integer) is
  'The applicant takes back their own open application (#1539), unless they are on trial.';

revoke all on function public.withdraw_application(integer) from public, anon;
grant execute on function public.withdraw_application(integer) to authenticated;

-- The applicant's own applications, for My applications: team, status, dates
-- and answers. Never notes, history or the conversation.
create function public.my_applications()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'team_name', t.name,
             'team_slug', t.slug,
             'guild_key', g.url_key,
             'name_realm', a.name_realm,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on,
             'answers', a.answers) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
      join guilds g on g.id = t.guild_id
     where a.person_id = my_person_id()), '[]'::jsonb);
end;
$$;

comment on function public.my_applications() is
  'The caller''s own applications (#1539, #1547), newest first: team, status, dates and answers. No notes, history or conversation.';

revoke all on function public.my_applications() from public, anon;
grant execute on function public.my_applications() to authenticated;

-- A record for someone who came in through a team's Discord ticket instead of
-- the form, by character. p_discord_id, when the officer has it, ties the
-- record to the person, so a later application of theirs is known.
create function public.add_recruit(p_team_id integer, p_name_realm text, p_discord_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
  v_person integer;
  v_name text := btrim(p_name_realm);
  v_char characters;
  v_id integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if recruit_access(p_team_id) is distinct from 'manage' then
    raise exception 'Not authorized';
  end if;
  perform 1 from teams t where t.id = p_team_id and t.archived_at is null for share;
  if not found then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if p_discord_id is not null then
    if p_discord_id !~ '^[0-9]{17,20}$' then
      raise exception 'That is not a Discord id';
    end if;
    v_person := person_for_discord_id(p_discord_id);
    if exists (select 1 from recruit_applications a
                where a.team_id = p_team_id and a.person_id = v_person and a.closed_at is null) then
      raise exception 'That person already has an open application with this team';
    end if;
    select * into v_char from characters c
     where c.person_id = v_person and c.name_realm_key = lower(replace(v_name, ' ', ''));
  end if;

  insert into recruit_applications (team_id, person_id, source, character_id, name_realm, class_name, spec_name, item_level)
  values (p_team_id, v_person, 'added_by_officer', v_char.id, coalesce(v_char.name_realm, v_name),
          v_char.class_name, v_char.spec_name, v_char.item_level)
  returning id into v_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (v_id, 'added_by_officer', v_me);
  perform recruit_log(p_team_id, v_me, 'Recruit Added', v_id, jsonb_build_object('name_realm', v_name));
  return v_id;
end;
$$;

comment on function public.add_recruit(integer, text, text) is
  'An officer adds a recruit record for a ticket-only applicant (#1539), by character name-realm and, if known, Discord id. For the team''s edit_recruiting holders and site admins.';

revoke all on function public.add_recruit(integer, text, text) from public, anon;
grant execute on function public.add_recruit(integer, text, text) to authenticated;

-- The Recruits page's list: open ones first, then newest.
create function public.team_recruits(p_team_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_access text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  v_access := recruit_access(p_team_id);
  if v_access is null then
    raise exception 'Not authorized';
  end if;
  return jsonb_build_object(
    'access', v_access,
    'recruits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'name', case when a.person_id is not null then guild_person_name(t.guild_id, a.person_id) end,
               'name_realm', a.name_realm,
               'class_name', a.class_name,
               'spec_name', a.spec_name,
               'item_level', a.item_level,
               'mplus_score', a.mplus_score,
               'logs_best_average', a.logs_best_average,
               'logs_median_average', a.logs_median_average,
               'mythic_bosses_killed', a.mythic_bosses_killed,
               'source', a.source,
               'status', a.status,
               'sent_by', a.sent_by,
               'sent_by_name', a.sent_by_name,
               'applied_at', a.applied_at,
               'closed_at', a.closed_at,
               'applicant_last_message_at', a.applicant_last_message_at,
               'officers_last_message_at', a.officers_last_message_at,
               'trial_starts_on', a.trial_starts_on,
               'trial_ends_on', a.trial_ends_on)
             order by a.closed_at is not null, a.applied_at desc, a.id desc)
        from recruit_applications a
        join teams t on t.id = a.team_id
       where a.team_id = p_team_id), '[]'::jsonb));
end;
$$;

comment on function public.team_recruits(integer) is
  'A team''s recruit records for its Recruits page (#1539, #1549), open first: the character copy, status, who sent them, dates and last-message times, plus the caller''s access (manage, note or read). For whoever recruit_access() lets in.';

revoke all on function public.team_recruits(integer) from public, anon;
grant execute on function public.team_recruits(integer) to authenticated;

-- One record. The team's people get all of it; the recruiter who sent the
-- person gets the name, team, status, dates and their own notes.
create function public.recruit_record(p_application_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
  v_app recruit_applications;
  v_guild integer;
  v_team_name text;
  v_access text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_app from recruit_applications where id = p_application_id;
  select t.guild_id, t.name into v_guild, v_team_name from teams t where t.id = v_app.team_id;
  v_access := recruit_access(v_app.team_id);
  if v_access is not null and v_app.id is null then
    raise exception 'That recruit does not exist';
  end if;
  if v_access is null then
    if v_app.recruiter_person_id is distinct from v_me or not in_guild(v_guild, v_me) then
      raise exception 'Not authorized';
    end if;
    return jsonb_build_object(
      'access', 'recruiter',
      'id', v_app.id,
      'team_id', v_app.team_id,
      'team_name', v_team_name,
      'name', case when v_app.person_id is not null then guild_person_name(v_guild, v_app.person_id) end,
      'name_realm', v_app.name_realm,
      'status', v_app.status,
      'applied_at', v_app.applied_at,
      'closed_at', v_app.closed_at,
      'trial_starts_on', v_app.trial_starts_on,
      'trial_ends_on', v_app.trial_ends_on,
      'notes', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'source', n.source, 'created_at', n.created_at)
                         order by n.created_at, n.id)
          from recruit_notes n
         where n.application_id = v_app.id and n.author_person_id = v_me), '[]'::jsonb));
  end if;

  return (to_jsonb(v_app) - 'person_id' - 'recruiter_person_id' - 'character_id') || jsonb_build_object(
    'access', v_access,
    'team_name', v_team_name,
    'name', case when v_app.person_id is not null then guild_person_name(v_guild, v_app.person_id) end,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'author', case when n.author_person_id is not null then guild_person_name(v_guild, n.author_person_id) end,
               'mine', n.author_person_id = v_me,
               'body', n.body,
               'source', n.source,
               'created_at', n.created_at) order by n.created_at, n.id)
        from recruit_notes n
       where n.application_id = v_app.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind,
               'actor', case when e.actor_person_id is not null then guild_person_name(v_guild, e.actor_person_id) end,
               'detail', e.detail,
               'created_at', e.created_at) order by e.created_at, e.id)
        from recruit_events e
       where e.application_id = v_app.id), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'author_name', m.author_name,
               'by_applicant', m.author_discord_id is not distinct from (select discord_id from people where id = v_app.person_id)
                               and m.author_discord_id is not null,
               'body', m.body,
               'attachments', m.attachments,
               'sent_at', m.sent_at) order by m.sent_at, m.id)
        from recruit_messages m
       where m.application_id = v_app.id), '[]'::jsonb),
    -- Earlier applications by the same person to the same guild, any team.
    'applied_before', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_name', t.name,
               'applied_at', a.applied_at,
               'status', a.status) order by a.applied_at desc)
        from recruit_applications a
        join teams t on t.id = a.team_id
       where a.person_id = v_app.person_id and t.guild_id = v_guild
         and (a.applied_at, a.id) < (v_app.applied_at, v_app.id)), '[]'::jsonb));
end;
$$;

comment on function public.recruit_record(integer) is
  'One recruit record (#1539, #1549): for whoever recruit_access() lets in, the whole record with notes, history, the saved conversation and earlier applications to the guild; for the recruiter who sent the person, the name, team, status, dates and their own notes. Never for the applicant.';

revoke all on function public.recruit_record(integer) from public, anon;
grant execute on function public.recruit_record(integer) to authenticated;

-- A recruiter's My recruits: the people they sent, in guilds they're still in.
create function public.my_recruits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'team_name', t.name,
             'name', case when a.person_id is not null then guild_person_name(t.guild_id, a.person_id) end,
             'name_realm', a.name_realm,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
     where a.recruiter_person_id = v_me and in_guild(t.guild_id, v_me)), '[]'::jsonb);
end;
$$;

comment on function public.my_recruits() is
  'The people the caller sent as a recruiter (#1539, #1550), in guilds they are still in: name, team, status and dates.';

revoke all on function public.my_recruits() from public, anon;
grant execute on function public.my_recruits() to authenticated;

create function public.add_recruit_note(p_application_id integer, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
  v_app recruit_applications;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_app from recruit_applications where id = p_application_id;
  if not (coalesce(recruit_access(v_app.team_id) in ('manage', 'note'), false)
          or coalesce(v_app.recruiter_person_id = v_me
                      and in_guild((select t.guild_id from teams t where t.id = v_app.team_id), v_me), false)) then
    raise exception 'Not authorized';
  end if;
  return recruit_add_note(p_application_id, v_me, 'site', p_body);
end;
$$;

comment on function public.add_recruit_note(integer, text) is
  'Adds a note to a recruit record from Raid Hub (#1539): the team''s officers and, when the team lets them see tickets, its assistants; the recruiter who sent the person, on them only.';

revoke all on function public.add_recruit_note(integer, text) from public, anon;
grant execute on function public.add_recruit_note(integer, text) to authenticated;

create function public.close_recruit(p_application_id integer, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if recruit_access((select team_id from recruit_applications where id = p_application_id)) is distinct from 'manage' then
    raise exception 'Not authorized';
  end if;
  perform recruit_close(p_application_id, my_person_id(), p_status, p_reason);
end;
$$;

comment on function public.close_recruit(integer, text, text) is
  'Closes an open recruit record as declined or no_reply, with an optional reason (#1539). For the team''s edit_recruiting holders and site admins.';

revoke all on function public.close_recruit(integer, text, text) from public, anon;
grant execute on function public.close_recruit(integer, text, text) to authenticated;

create function public.reopen_recruit(p_application_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if recruit_access((select team_id from recruit_applications where id = p_application_id)) is distinct from 'manage' then
    raise exception 'Not authorized';
  end if;
  perform recruit_reopen(p_application_id, my_person_id());
end;
$$;

comment on function public.reopen_recruit(integer) is
  'Reopens a declined or no-reply recruit record (#1539), unless the person has another open one with the team. For the team''s edit_recruiting holders and site admins.';

revoke all on function public.reopen_recruit(integer) from public, anon;
grant execute on function public.reopen_recruit(integer) to authenticated;

-- The bot's versions. A Discord button arrives with a Discord id, not a
-- signed-in user; the bot checks that person may act, then calls these with
-- the service key. Same actions, history and audit rows as the site's.
create function public.bot_actor(p_discord_id text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_id integer;
begin
  select id into v_id from people where discord_id = p_discord_id;
  if v_id is null then
    raise exception 'Nobody on Raid Hub has that Discord id';
  end if;
  return v_id;
end;
$$;

revoke all on function public.bot_actor(text) from public, anon, authenticated;

create function public.bot_add_recruit_note(p_application_id integer, p_actor_discord_id text, p_body text)
returns integer
language sql
set search_path = public
as $$
  select recruit_add_note(p_application_id, bot_actor(p_actor_discord_id), 'discord', p_body);
$$;

create function public.bot_close_recruit(p_application_id integer, p_actor_discord_id text, p_status text, p_reason text)
returns void
language sql
set search_path = public
as $$
  select recruit_close(p_application_id, bot_actor(p_actor_discord_id), p_status, p_reason);
$$;

create function public.bot_reopen_recruit(p_application_id integer, p_actor_discord_id text)
returns void
language sql
set search_path = public
as $$
  select recruit_reopen(p_application_id, bot_actor(p_actor_discord_id));
$$;

comment on function public.bot_add_recruit_note(integer, text, text) is
  'The bot''s Add note button (#1539): adds a note as the person with that Discord id, source discord. Service role only; the bot checks the person may.';
comment on function public.bot_close_recruit(integer, text, text, text) is
  'The bot''s Decline button and no-reply close (#1539), as the person with that Discord id. Service role only; the bot checks the person may.';
comment on function public.bot_reopen_recruit(integer, text) is
  'The bot''s reopen (#1539), as the person with that Discord id. Service role only; the bot checks the person may.';

revoke all on function public.bot_add_recruit_note(integer, text, text) from public, anon, authenticated;
grant execute on function public.bot_add_recruit_note(integer, text, text) to service_role;
revoke all on function public.bot_close_recruit(integer, text, text, text) from public, anon, authenticated;
grant execute on function public.bot_close_recruit(integer, text, text, text) to service_role;
revoke all on function public.bot_reopen_recruit(integer, text) from public, anon, authenticated;
grant execute on function public.bot_reopen_recruit(integer, text) to service_role;
grant execute on function public.bot_actor(text) to service_role;
grant execute on function public.recruit_add_note(integer, integer, text, text) to service_role;
grant execute on function public.recruit_close(integer, integer, text, text) to service_role;
grant execute on function public.recruit_reopen(integer, integer) to service_role;
grant execute on function public.recruit_lock(integer) to service_role;
grant execute on function public.recruit_log(integer, integer, text, integer, jsonb) to service_role;

-- Pictures follow the records now: whoever recruit_access() lets in sees a
-- team's, as well as the uploader (#1536's review).
drop policy "Uploader and team officers view application pictures" on storage.objects;
create policy "Uploader and recruit readers view application pictures" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'application-pictures'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.recruit_access(public.application_picture_team(name)) is not null
    )
  );
