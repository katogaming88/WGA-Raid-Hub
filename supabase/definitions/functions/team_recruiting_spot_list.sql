-- Function public.team_recruiting_spot_list: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_recruiting_spot_list(p_team_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'role', s.role,
           'class_spec_id', s.class_spec_id,
           'class', cs.class,
           'spec', cs.spec,
           'priority', s.priority) order by s.sort_order, s.id), '[]'::jsonb)
    from team_recruiting_spots s
    left join classes_specs cs on cs.id = s.class_spec_id
   where s.team_id = p_team_id;
$function$;
