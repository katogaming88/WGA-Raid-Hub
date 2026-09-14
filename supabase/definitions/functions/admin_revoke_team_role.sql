-- Function public.admin_revoke_team_role: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_revoke_team_role(p_team_id integer, p_discord_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.team_members%rowtype;
  v_claimed integer;
begin
  if not (public.is_site_admin() or coalesce(public.my_team_role(p_team_id) = 'team_leader', false)) then
    raise exception 'Not authorized';
  end if;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id and discord_id = p_discord_id
  for update;

  if not found then
    raise exception 'That Discord account does not have a role on this team';
  end if;

  -- players_team_member_id_fkey is ON DELETE SET NULL, so deleting a member a
  -- character points at would silently unclaim that character, with no error
  -- anywhere and nothing in the audit log saying it happened. Somebody who
  -- has claimed a character stays on the team as a raider instead.
  select count(*) into v_claimed from public.players where team_member_id = v_existing.id;

  if v_claimed > 0 then
    update public.team_members set role = 'raider' where id = v_existing.id;

    perform public.write_audit_log(
      p_team_id, 'team_role_demoted', 'team_member', v_existing.id,
      jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role, 'claimed_characters', v_claimed)
    );
    return;
  end if;

  delete from public.team_members where id = v_existing.id;

  perform public.write_audit_log(
    p_team_id, 'team_role_revoked', 'team_member', v_existing.id,
    jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role)
  );
end;
$function$;
