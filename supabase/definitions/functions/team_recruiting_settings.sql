-- Function public.team_recruiting_settings: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_recruiting_settings(p_team_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
