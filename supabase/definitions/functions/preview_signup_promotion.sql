-- Function public.preview_signup_promotion: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.preview_signup_promotion(p_team_id integer, p_season text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  v_plan := public.signup_promotion_plan(p_team_id, p_season);

  return jsonb_build_object('expected', md5(v_plan::text))
      || (select jsonb_object_agg(k, coalesce(
                   (select jsonb_agg(jsonb_strip_nulls(e - 'kind'))
                      from jsonb_array_elements(v_plan) e
                     where e ->> 'kind' = k),
                   '[]'::jsonb))
            from unnest(array['stays', 'joins', 'swaps', 'first_mains', 'archives', 'skipped']) k);
end;
$function$;
