-- Function public.danger_clear_mplus_exclusion_requests: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.danger_clear_mplus_exclusion_requests(p_team_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.mplus_exclusion_requests where team_id = p_team_id;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
