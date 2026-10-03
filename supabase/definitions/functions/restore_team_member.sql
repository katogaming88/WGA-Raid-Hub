-- Function public.restore_team_member: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.restore_team_member(p_team_id integer, p_team_member_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_archived_at timestamptz;
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- Locked, as in archive_team_member(), so a restore and an archive of the
  -- same person run one after the other.
  select team_id, archived_at into v_team_id, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  if v_archived_at is null then
    return;
  end if;

  perform public.write_audit_log(
    p_team_id, 'team_member_restored', 'team_member', p_team_member_id,
    jsonb_build_object('role', 'raider')
  );

  -- Back as a raider whatever role the archived row held, as through the
  -- invite link; a role above that is the team leader's to grant.
  update public.team_members set archived_at = null, role = 'raider' where id = p_team_member_id;
end;
$function$;
