-- #1536: the questions on a team's application form, the database half (#1551).
-- The officers' Recruiting settings page (#1548) changes them, and the form
-- (#1547) reads them. Storing answers is the applications issue (#1539).
--
-- What this adds:
--
-- * application_starter_questions: the starter set, site-wide and the same for
--   every guild, seeded here and never edited by a team. Each has a fixed key,
--   a group, a short name for the settings page, the wording applicants see,
--   an answer type, and whether it starts on and required.
-- * team_application_starters: only what a team changed about a starter
--   question (switched off or on, required or not). A team with no rows gets
--   the defaults, and a starter question added later reaches every team
--   without a backfill. A team rewords a starter question by switching it off
--   and writing its own.
-- * team_application_questions: a team's own questions, in its order, shown
--   after the starter questions as the settings page shows them. Ids stay
--   fixed across saves so answers (#1539) can point at them.
-- * Three functions, the only way in:
--   team_application_questions() is the settings page's read (every starter
--   question with its on and required, and the team's own),
--   save_team_application_questions() saves the whole section,
--   team_application_form() is the form's read for anyone signed in, only the
--   questions that are on.
-- * application-pictures, a private Storage bucket for picture answers.
--   An applicant uploads into <team id>/<their user id>/ while the team takes
--   applications; the uploader and the team's officers can view it.
--
-- {team} and {raid nights} in a question's wording are left for the page to
-- fill: the nights come from raid_schedule (team_recruiting_page() returns
-- them), shown in the applicant's own time zone, so the wording never goes
-- stale. Character, item level, M+ score and logs are never questions; they
-- come from the applicant's character.

create table public.application_starter_questions (
  key text primary key
    constraint application_starter_questions_key check (key ~ '^[a-z_]{1,30}$'),
  group_name text not null
    constraint application_starter_questions_group check (
      group_name in ('About them', 'Raiding background', 'Fitting the team', 'How they found you')
    ),
  label text not null
    constraint application_starter_questions_label check (char_length(label) between 1 and 40),
  prompt text not null
    constraint application_starter_questions_prompt check (char_length(prompt) between 1 and 300),
  -- recruiter: one of the guild's recruiters, a friend in the guild (then:
  -- who?), or nobody. Starter questions only.
  answer_type text not null
    constraint application_starter_questions_answer_type check (
      answer_type in ('short_text', 'paragraph', 'link', 'choice', 'yes_no', 'picture', 'recruiter')
    ),
  max_length integer,
  choices text[] not null default '{}',
  default_on boolean not null,
  default_required boolean not null,
  sort_order integer not null unique,
  constraint application_starter_questions_required_on check (default_on or not default_required),
  constraint application_starter_questions_max_length check (
    case when answer_type in ('short_text', 'paragraph') then coalesce(max_length between 1 and 4000, false)
         else max_length is null end
  ),
  constraint application_starter_questions_choices check (
    case when answer_type = 'choice'
         then cardinality(choices) between 2 and 10 and public.text_items_match(choices, '^(?=.*\S)[^\r\n]{1,100}$')
         else cardinality(choices) = 0 end
  )
);

comment on table public.application_starter_questions is
  'The starter application questions (#1536), site-wide and the same for every guild, seeded by migration. A team switches each on or off and marks it required (team_application_starters); it never edits one. {team} and {raid nights} in prompt are filled by the page.';
comment on column public.application_starter_questions.label is
  'The short name the Recruiting settings page shows, e.g. Raid experience.';
comment on column public.application_starter_questions.prompt is
  'The wording applicants see.';
comment on column public.application_starter_questions.answer_type is
  'short_text and paragraph take max_length; choice takes choices; recruiter is Who sent you? (a recruiter, a friend in the guild, or nobody).';

insert into public.application_starter_questions
  (key, group_name, label, prompt, answer_type, max_length, choices, default_on, default_required, sort_order)
values
  ('about', 'About them', 'A line about themselves', 'Tell the team about yourself.', 'short_text', 100, '{}', true, true, 10),
  ('why', 'About them', 'Why this team', 'What made you want to raid with {team}?', 'paragraph', 2000, '{}', true, false, 20),
  ('other', 'About them', 'Anything else', 'Anything else you''d like us to know?', 'paragraph', 2000, '{}', true, false, 30),
  ('experience', 'Raiding background', 'Raid experience', 'What have you raided, and on what difficulty?', 'paragraph', 2000, '{}', true, true, 40),
  ('guild', 'Raiding background', 'Current or last guild', 'What guild are you in now, or were you in last? Why are you looking?', 'paragraph', 2000, '{}', true, false, 50),
  ('goals', 'Raiding background', 'Goals this season', 'What do you want to get done this season?', 'paragraph', 2000, '{}', false, false, 60),
  ('log', 'Raiding background', 'A log they''re proud of', 'Link a log you''re proud of.', 'link', null, '{}', true, false, 70),
  ('nights', 'Fitting the team', 'Raid nights', 'Can you make {raid nights}?', 'choice', null, '{Every week,Most weeks,Not really}', true, true, 80),
  ('voice', 'Fitting the team', 'Voice', 'Can you listen on Discord voice and talk for callouts?', 'yes_no', null, '{}', true, false, 90),
  ('ui', 'Fitting the team', 'UI screenshot', 'Add a screenshot of your UI in combat.', 'picture', null, '{}', false, false, 100),
  ('computer', 'Fitting the team', 'Computer', 'Any computer or connection trouble we should know about?', 'paragraph', 2000, '{}', false, false, 110),
  ('sent_by', 'How they found you', 'Who sent them', 'Who sent you?', 'recruiter', null, '{}', true, false, 120);

create table public.team_application_starters (
  team_id integer not null references public.team_recruiting(team_id) on delete cascade,
  starter_key text not null references public.application_starter_questions(key) on delete cascade,
  is_on boolean not null,
  required boolean not null,
  primary key (team_id, starter_key),
  constraint team_application_starters_required_on check (is_on or not required)
);

comment on table public.team_application_starters is
  'What a team changed about a starter question (#1536): a row only where is_on or required differs from the starter''s default. No row: the default. Saved through save_team_application_questions().';

create table public.team_application_questions (
  id integer generated always as identity primary key,
  team_id integer not null references public.team_recruiting(team_id) on delete cascade,
  label text not null
    constraint team_application_questions_label check (char_length(label) <= 40 and label ~ '\S' and label !~ '[\r\n]'),
  prompt text not null
    constraint team_application_questions_prompt check (char_length(prompt) <= 300 and prompt ~ '\S' and prompt !~ '[\r\n]'),
  answer_type text not null
    constraint team_application_questions_answer_type check (
      answer_type in ('short_text', 'paragraph', 'link', 'choice', 'yes_no', 'picture')
    ),
  max_length integer,
  choices text[] not null default '{}',
  required boolean not null default false,
  sort_order integer not null,
  constraint team_application_questions_max_length check (
    case answer_type when 'short_text' then coalesce(max_length between 1 and 200, false)
                     when 'paragraph' then coalesce(max_length between 1 and 4000, false)
                     else max_length is null end
  ),
  constraint team_application_questions_choices check (
    case when answer_type = 'choice'
         then cardinality(choices) between 2 and 10 and public.text_items_match(choices, '^(?=.*\S)[^\r\n]{1,100}$')
         else cardinality(choices) = 0 end
  )
);

create index team_application_questions_team on public.team_application_questions (team_id, sort_order);

comment on table public.team_application_questions is
  'A team''s own application questions (#1536), in sort_order after the starter questions. Up to 20. short_text takes a max_length up to 200, paragraph up to 4,000; choice takes 2 to 10 choices. Saved through save_team_application_questions(), which keeps each question''s id.';

alter table public.application_starter_questions owner to postgres;
alter table public.application_starter_questions enable row level security;
alter table public.team_application_starters owner to postgres;
alter table public.team_application_starters enable row level security;
alter table public.team_application_questions owner to postgres;
alter table public.team_application_questions enable row level security;

create policy "Claude readers read application_starter_questions" on public.application_starter_questions
  for select to claude_readers using (true);
create policy "Claude readers read team_application_starters" on public.team_application_starters
  for select to claude_readers using (true);
create policy "Claude readers read team_application_questions" on public.team_application_questions
  for select to claude_readers using (true);

-- Nobody reads or writes these directly: the functions run as their owner,
-- and the bot uses the service key.
revoke all on table public.application_starter_questions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.application_starter_questions to service_role;
revoke all on table public.team_application_starters from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_application_starters to service_role;
revoke all on table public.team_application_questions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_application_questions to service_role;

-- One team's questions, starter questions first in their order, then its own.
-- Called only from the functions below, which run as the owner.
create function public.team_application_question_list(p_team_id integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'starters', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', s.key,
               'group', s.group_name,
               'label', s.label,
               'prompt', s.prompt,
               'answer_type', s.answer_type,
               'max_length', s.max_length,
               'choices', to_jsonb(s.choices),
               'on', coalesce(t.is_on, s.default_on),
               'required', coalesce(t.required, s.default_required)) order by s.sort_order), '[]'::jsonb)
        from application_starter_questions s
        left join team_application_starters t on t.starter_key = s.key and t.team_id = p_team_id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id,
               'label', q.label,
               'prompt', q.prompt,
               'answer_type', q.answer_type,
               'max_length', q.max_length,
               'choices', to_jsonb(q.choices),
               'required', q.required) order by q.sort_order, q.id), '[]'::jsonb)
        from team_application_questions q
       where q.team_id = p_team_id));
$$;

revoke all on function public.team_application_question_list(integer) from public, anon, authenticated;

-- The settings page's read: every starter question with this team's on and
-- required, and the team's own questions.
create function public.team_application_questions(p_team_id integer)
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
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from team_recruiting r where r.team_id = p_team_id) then
    raise exception 'That team does not exist';
  end if;
  return team_application_question_list(p_team_id);
end;
$$;

comment on function public.team_application_questions(integer) is
  'A team''s application questions for its Recruiting settings page (#1536): starters (every starter question with on and required) and questions (its own, in order). For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.team_application_questions(integer) from public, anon;
grant execute on function public.team_application_questions(integer) to authenticated;

-- Saves the whole Application questions section.
-- p_starters: {"goals": {"on": true, "required": false}, ...}; a starter
-- question it doesn't name keeps the team's current setting.
-- p_questions: the team's own questions, the whole list in order, e.g.
-- [{"id": 7, "label": "Off-spec", "prompt": "OK swapping to an off-spec?",
--   "answer_type": "yes_no", "required": false},
--  {"label": "Main", "prompt": "Your main spec?", "answer_type": "short_text",
--   "max_length": 50, "required": true}].
-- A question with an id is that question, changed in place; without, a new
-- one; one left out is deleted. Logged once when anything changed.
create function public.save_team_application_questions(p_team_id integer, p_starters jsonb, p_questions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_val jsonb;
  v_on boolean;
  v_required boolean;
  v_q jsonb;
  v_n integer := 0;
  v_id integer;
  v_ids integer[] := '{}'::integer[];
  v_choices text[];
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  -- The team row's share lock holds off an archive until this save commits
  -- (CodeRabbit).
  perform 1 from teams t where t.id = p_team_id for share;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_starters) is distinct from 'object' then
    raise exception 'Starter questions must be an object';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'Questions must be a list';
  end if;
  if jsonb_array_length(p_questions) > 20 then
    raise exception 'A team has at most 20 questions of its own';
  end if;
  perform 1 from team_recruiting r where r.team_id = p_team_id for update;
  if not found then
    raise exception 'That team does not exist';
  end if;

  v_old := team_application_question_list(p_team_id);

  for v_key, v_val in select key, value from jsonb_each(p_starters)
  loop
    if not exists (select 1 from application_starter_questions s where s.key = v_key) then
      raise exception 'That is not a starter question: %', v_key;
    end if;
    if jsonb_typeof(v_val) is distinct from 'object'
       or jsonb_typeof(v_val -> 'on') is distinct from 'boolean'
       or jsonb_typeof(v_val -> 'required') is distinct from 'boolean'
       or exists (select 1 from jsonb_object_keys(v_val) as k where k not in ('on', 'required')) then
      raise exception 'A starter question takes on and required, both true or false';
    end if;
    v_on := (v_val ->> 'on')::boolean;
    v_required := (v_val ->> 'required')::boolean;
    if v_required and not v_on then
      raise exception 'A question that is off can''t be required';
    end if;

    delete from team_application_starters where team_id = p_team_id and starter_key = v_key;
    -- Only a change from the default is kept, so a later change to a default
    -- reaches every team that never touched it.
    insert into team_application_starters (team_id, starter_key, is_on, required)
    select p_team_id, s.key, v_on, v_required
      from application_starter_questions s
     where s.key = v_key and (s.default_on <> v_on or s.default_required <> v_required);
  end loop;

  for v_q in select value from jsonb_array_elements(p_questions)
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_q) is distinct from 'object' then
      raise exception 'Each question must be an object';
    end if;
    if exists (select 1 from jsonb_object_keys(v_q) as k
                where k not in ('id', 'label', 'prompt', 'answer_type', 'max_length', 'choices', 'required')) then
      raise exception 'A question has only id, label, prompt, answer_type, max_length, choices and required';
    end if;
    if v_q ? 'choices' and jsonb_typeof(v_q -> 'choices') is distinct from 'array' then
      raise exception 'A question''s choices must be a list';
    end if;
    if v_q ? 'required' and jsonb_typeof(v_q -> 'required') is distinct from 'boolean' then
      raise exception 'A question''s required is true or false';
    end if;
    v_choices := coalesce((select array_agg(c) from jsonb_array_elements_text(v_q -> 'choices') as c), '{}');
    v_id := (v_q ->> 'id')::integer;

    if v_id is null then
      insert into team_application_questions
        (team_id, label, prompt, answer_type, max_length, choices, required, sort_order)
      values (p_team_id, v_q ->> 'label', v_q ->> 'prompt', v_q ->> 'answer_type',
              (v_q ->> 'max_length')::integer, v_choices,
              coalesce((v_q ->> 'required')::boolean, false), v_n)
      returning id into v_id;
    else
      if v_id = any (v_ids) then
        raise exception 'That question is on the list twice';
      end if;
      update team_application_questions q
         set label = v_q ->> 'label',
             prompt = v_q ->> 'prompt',
             answer_type = v_q ->> 'answer_type',
             max_length = (v_q ->> 'max_length')::integer,
             choices = v_choices,
             required = coalesce((v_q ->> 'required')::boolean, false),
             sort_order = v_n
       where q.id = v_id and q.team_id = p_team_id;
      if not found then
        raise exception 'That question is not one of this team''s';
      end if;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  delete from team_application_questions q
   where q.team_id = p_team_id and q.id <> all (v_ids);

  v_new := team_application_question_list(p_team_id);
  if v_new = v_old then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Recruiting Questions Changed', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', v_new));
end;
$$;

comment on function public.save_team_application_questions(integer, jsonb, jsonb) is
  'Saves a team''s Application questions section (#1536): on and required for the starter questions p_starters names, and p_questions as the whole list of its own, in order (an id keeps that question; a question left out is deleted). All of a save applies or none of it; logged when anything changed. For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.save_team_application_questions(integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_team_application_questions(integer, jsonb, jsonb) to authenticated;

-- The form's read, for anyone signed in (applying needs a Battle.net sign-in)
-- while the team takes applications, and for its officers any time, so they
-- can look at their form. Only the questions that are on.
create function public.team_application_form(p_team_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from team_recruiting r join teams t on t.id = r.team_id
                  where r.team_id = p_team_id and r.taking_applications and t.archived_at is null)
     and not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'That team isn''t taking applications';
  end if;
  if not exists (select 1 from team_recruiting r where r.team_id = p_team_id) then
    raise exception 'That team does not exist';
  end if;

  v_list := team_application_question_list(p_team_id);
  return jsonb_build_object(
    'starters', coalesce((
      select jsonb_agg(s - 'on' - 'label' order by o)
        from jsonb_array_elements(v_list -> 'starters') with ordinality as e(s, o)
       where (s ->> 'on')::boolean), '[]'::jsonb),
    'questions', v_list -> 'questions');
end;
$$;

comment on function public.team_application_form(integer) is
  'A team''s application form (#1536, #1547): the starter questions that are on (key, group, prompt, answer_type, max_length, choices, required) and its own questions, in order. For anyone signed in while the team takes applications, and its officers and site admins any time. The page fills {team} and {raid nights}.';

revoke all on function public.team_application_form(integer) from public, anon;
grant execute on function public.team_application_form(integer) to authenticated;

-- Picture answers. Private: no public URL. Storage itself refuses a file
-- over 5 MB or of another type.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-pictures', 'application-pictures', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- The team a picture's folder names, for the bucket's rules below; null for
-- anything that isn't a team id.
create function public.application_picture_team(p_name text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9]{1,9}$'
              then ((storage.foldername(p_name))[1])::integer end;
$$;

-- Whether a team takes applications, for the upload rule (the caller can't
-- read team_recruiting).
create function public.team_takes_applications(p_team_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from team_recruiting r join teams t on t.id = r.team_id
                  where r.team_id = p_team_id and r.taking_applications and t.archived_at is null);
$$;

revoke all on function public.team_takes_applications(integer) from public, anon;
grant execute on function public.team_takes_applications(integer) to authenticated;

-- An applicant uploads only into <team id>/<their own user id>/, while that
-- team takes applications. Nobody changes or deletes one from the page.
create policy "Applicants upload application pictures" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'application-pictures'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.team_takes_applications(public.application_picture_team(name))
  );

-- The uploader sees their own; the team's officers see the team's.
create policy "Uploader and team officers view application pictures" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'application-pictures'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.has_team_permission(public.application_picture_team(name), 'edit_recruiting')
      or public.is_site_admin()
    )
  );
