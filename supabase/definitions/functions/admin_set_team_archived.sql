-- Function public.admin_set_team_archived: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_set_team_archived(p_team_id integer, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.teams
  set archived_at = case when p_archived then now() else null end
  where id = p_team_id;

  perform public.write_audit_log(
    p_team_id,
    case when p_archived then 'team_archived' else 'team_unarchived' end,
    'team',
    p_team_id,
    null
  );
end;
$function$;
