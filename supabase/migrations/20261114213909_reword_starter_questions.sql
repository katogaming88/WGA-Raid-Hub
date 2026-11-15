-- #1826: a team rewords a starter application question in place, instead of
-- switching it off and writing its own (20261109100209_application_questions.sql
-- decided that; this reverses it).
--
-- * team_application_starters.prompt: the team's wording, or null for the
--   starter wording. Same limits as a team's own question: one line, 1 to 300
--   characters. A row is kept when on, required or the wording differs from
--   the starter's.
-- * team_application_question_list(): a starter's prompt is the team's wording
--   when it has one, and starter_prompt is always the starter wording (the
--   settings page shows Reworded and offers Reset). send_application() reads
--   this list, so an application keeps the wording the applicant answered.
-- * save_team_application_questions(): a starter question also takes prompt.
--   A string is the team's wording (the starter wording itself, or the same
--   after trimming, counts as none); null puts the starter wording back; left
--   out keeps the team's current wording.
-- * team_application_form(): leaves starter_prompt out.
--
-- Only the wording changes: answer type, choices, group and place stay the
-- starter's.

alter table public.team_application_starters
  add column prompt text
    constraint team_application_starters_prompt check (char_length(prompt) <= 300 and prompt ~ '\S' and prompt !~ '[\r\n]');

comment on table public.team_application_starters is
  'What a team changed about a starter question (#1536, #1826): a row only where is_on, required or the wording differs from the starter''s. No row: the default. Saved through save_team_application_questions().';
comment on column public.team_application_starters.prompt is
  'The team''s wording for this starter question (#1826), or null for the starter wording. {team} and {raid nights} are filled by the page.';
comment on table public.application_starter_questions is
  'The starter application questions (#1536), site-wide and the same for every guild, seeded by migration. A team switches each on or off, marks it required and can reword it (team_application_starters); answer type, choices and group stay as here. {team} and {raid nights} in prompt are filled by the page.';

create or replace function public.team_application_question_list(p_team_id integer)
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
               'prompt', coalesce(t.prompt, s.prompt),
               'starter_prompt', s.prompt,
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

comment on function public.team_application_questions(integer) is
  'A team''s application questions for its Recruiting settings page (#1536, #1826): starters (every starter question with on, required, the team''s wording as prompt and the starter wording as starter_prompt) and questions (its own, in order). For anyone whose team rank has edit_recruiting, and site admins.';

-- Saves the whole Application questions section.
-- p_starters: {"computer": {"on": true, "required": false,
--   "prompt": "What are your computer specs?"}, ...}; a starter question it
-- doesn't name keeps the team's current setting, and one without prompt keeps
-- the team's current wording. prompt null is the starter wording.
-- p_questions: the team's own questions, the whole list in order, e.g.
-- [{"id": 7, "label": "Off-spec", "prompt": "OK swapping to an off-spec?",
--   "answer_type": "yes_no", "required": false},
--  {"label": "Main", "prompt": "Your main spec?", "answer_type": "short_text",
--   "max_length": 50, "required": true}].
-- A question with an id is that question, changed in place; without, a new
-- one; one left out is deleted. Logged once when anything changed.
create or replace function public.save_team_application_questions(p_team_id integer, p_starters jsonb, p_questions jsonb)
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
  v_prompt text;
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
       or (v_val ? 'prompt' and jsonb_typeof(v_val -> 'prompt') not in ('string', 'null'))
       or exists (select 1 from jsonb_object_keys(v_val) as k where k not in ('on', 'required', 'prompt')) then
      raise exception 'A starter question takes on and required, both true or false, and its wording';
    end if;
    v_on := (v_val ->> 'on')::boolean;
    v_required := (v_val ->> 'required')::boolean;
    if v_required and not v_on then
      raise exception 'A question that is off can''t be required';
    end if;
    if v_val ? 'prompt' then
      v_prompt := btrim(v_val ->> 'prompt');
      if v_prompt is not null and (v_prompt !~ '\S' or char_length(v_prompt) > 300 or v_prompt ~ '[\r\n]') then
        raise exception 'A question''s wording is one line of 1 to 300 characters';
      end if;
    else
      select t.prompt into v_prompt
        from team_application_starters t
       where t.team_id = p_team_id and t.starter_key = v_key;
    end if;

    delete from team_application_starters where team_id = p_team_id and starter_key = v_key;
    -- Only a change from the default is kept, so a later change to a default
    -- reaches every team that never touched it.
    insert into team_application_starters (team_id, starter_key, is_on, required, prompt)
    select p_team_id, s.key, v_on, v_required, nullif(v_prompt, s.prompt)
      from application_starter_questions s
     where s.key = v_key
       and (s.default_on <> v_on or s.default_required <> v_required or nullif(v_prompt, s.prompt) is not null);
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
    if exists (select 1 from jsonb_array_elements(v_q -> 'choices') as c where jsonb_typeof(c) <> 'string') then
      raise exception 'Each choice is text';
    end if;
    if (select count(*) <> count(distinct c) from jsonb_array_elements_text(v_q -> 'choices') as c) then
      raise exception 'A choice is listed twice';
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
  'Saves a team''s Application questions section (#1536, #1826): on, required and wording for the starter questions p_starters names (prompt null is the starter wording; left out keeps the current wording), and p_questions as the whole list of its own, in order (an id keeps that question; a question left out is deleted). All of a save applies or none of it; logged when anything changed. For anyone whose team rank has edit_recruiting, and site admins.';

revoke all on function public.save_team_application_questions(integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_team_application_questions(integer, jsonb, jsonb) to authenticated;

create or replace function public.team_application_form(p_team_id integer)
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
      select jsonb_agg(s - 'on' - 'label' - 'starter_prompt' order by o)
        from jsonb_array_elements(v_list -> 'starters') with ordinality as e(s, o)
       where (s ->> 'on')::boolean), '[]'::jsonb),
    'questions', v_list -> 'questions');
end;
$$;

comment on function public.team_application_form(integer) is
  'A team''s application form (#1536, #1547, #1826): the starter questions that are on (key, group, prompt in the team''s wording, answer_type, max_length, choices, required) and its own questions, in order. For anyone signed in while the team takes applications, and its officers and site admins any time. The page fills {team} and {raid nights}.';

revoke all on function public.team_application_form(integer) from public, anon;
grant execute on function public.team_application_form(integer) to authenticated;
