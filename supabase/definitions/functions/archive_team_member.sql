-- Function public.archive_team_member: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.archive_team_member(p_team_id integer, p_team_member_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_role text;
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select team_id, role into v_team_id, v_role from public.team_members where id = p_team_member_id;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  -- Ending an officer's or the leader's membership is a role change, which
  -- belongs to the team leader or a site admin, as in admin_revoke_team_role().
  if v_role in ('officer', 'team_leader')
     and not (coalesce(public.my_team_role(p_team_id) = 'team_leader', false) or public.is_site_admin()) then
    raise exception 'Only the team leader or a site admin can archive an officer or the team leader';
  end if;

  -- Logged before the archive, not after: write_audit_log() re-checks the
  -- caller's own officer status live, and a team leader archiving their own
  -- membership would otherwise fail that check the instant their own row
  -- says archived_at is not null, aborting the archive it just did.
  perform public.write_audit_log(p_team_id, 'team_member_archived', 'team_member', p_team_member_id);

  update public.team_members set archived_at = now() where id = p_team_member_id and archived_at is null;
  update public.players set archived_at = now() where team_member_id = p_team_member_id and archived_at is null;
end;
$function$;
