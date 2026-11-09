-- Function public.save_team_application_questions: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_team_application_questions(p_team_id integer, p_starters jsonb, p_questions jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_ids integer[] := '{}';
  v_choices text[];
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
$function$;
