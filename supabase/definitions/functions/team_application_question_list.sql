-- Function public.team_application_question_list: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_application_question_list(p_team_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
