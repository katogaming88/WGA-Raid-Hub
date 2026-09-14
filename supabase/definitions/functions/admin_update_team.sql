-- Function public.admin_update_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_update_team(p_team_id integer, p_name text, p_slug text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.teams set name = p_name, slug = p_slug where id = p_team_id;

  perform public.write_audit_log(p_team_id, 'team_updated', 'team', p_team_id, jsonb_build_object('name', p_name, 'slug', p_slug));
end;
$function$;
