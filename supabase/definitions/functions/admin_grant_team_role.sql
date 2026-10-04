-- Function public.admin_grant_team_role: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_grant_team_role(p_team_id integer, p_discord_id text, p_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team public.teams%rowtype;
  v_existing public.team_members%rowtype;
  v_auth_user_id uuid;
  v_id integer;
begin
  if not (public.is_site_admin() or coalesce(public.my_team_role(p_team_id) = 'team_leader', false)) then
    raise exception 'Not authorized';
  end if;

  if p_role is null or p_role not in ('raider', 'officer', 'team_leader') then
    raise exception 'Role must be one of raider, officer, team_leader';
  end if;

  if p_discord_id is null or btrim(p_discord_id) = '' then
    raise exception 'A Discord id is required';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'No team with id %', p_team_id;
  end if;
  if v_team.archived_at is not null then
    raise exception 'That team is archived';
  end if;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id
    and person_id = (select id from public.people where discord_id = p_discord_id)
  for update;

  -- Someone archived off the team holds no role on it, so the grant brings
  -- them back with the one it gives, in the row locked above. Their
  -- characters stay archived: an officer re-adds the ones they play.
  if found and v_existing.archived_at is not null then
    -- Only a site admin archives a team leader, so only a site admin brings
    -- anyone back as one; a team leader brings them back below it.
    if p_role = 'team_leader' and not public.is_site_admin() then
      raise exception 'Only a site admin can bring someone who left back as team leader';
    end if;

    perform public.write_audit_log(
      p_team_id, 'team_member_restored', 'team_member', v_existing.id,
      jsonb_build_object('role', p_role, 'archived_role', v_existing.role)
    );

    update public.team_members set archived_at = null, role = p_role
     where id = v_existing.id
     returning auth_user_id into v_auth_user_id;

    perform public.write_audit_log(
      p_team_id, 'team_role_granted', 'team_member', v_existing.id,
      jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null, 'restored', true)
    );

    return v_auth_user_id;
  end if;

  if found then
    -- An existing row is never rewritten. `role` drives every team role
    -- helper and a wide slice of the read rules, so overwriting it would let
    -- one mistyped Discord id demote a sitting team leader. Changing a role
    -- stays with the promote path in the officer dashboard.
    if v_existing.role is distinct from p_role then
      raise exception 'That Discord account already has the % role on this team. Change a role through the promote path, not this grant.', v_existing.role;
    end if;
    if v_existing.auth_user_id is null then
      raise exception 'That Discord account already has the % role on this team, and no account exists for it to link to yet.', v_existing.role;
    end if;
    raise exception 'That Discord account already has the % role on this team.', v_existing.role;
  end if;

  insert into public.team_members (team_id, discord_id, role)
  values (p_team_id, p_discord_id, p_role)
  returning id, auth_user_id into v_id, v_auth_user_id;

  perform public.write_audit_log(
    p_team_id, 'team_role_granted', 'team_member', v_id,
    jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null)
  );

  return v_auth_user_id;
end;
$function$;
