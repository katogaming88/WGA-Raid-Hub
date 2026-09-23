-- Function public.team_invite_link_revoke: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_invite_link_revoke(p_team_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.team_invite_links where team_id = p_team_id;

  perform public.write_audit_log(p_team_id, 'Invite Link Revoked', 'team_invite_links', p_team_id, '{}'::jsonb);
end;
$function$;
