-- Function public.team_application_form: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_application_form(p_team_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
