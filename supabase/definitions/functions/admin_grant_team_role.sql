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
  if not (public.is_site_admin() or public.my_team_role(p_team_id) = 'team_leader') then
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

  -- Resolved here rather than left for a trigger to fill later. The trigger
  -- that does exist, on_auth_user_created, is AFTER INSERT ON auth.users, so
  -- it fires once at account creation and never again: a row inserted for
  -- somebody who signed in months ago would keep a null auth_user_id, read as
  -- no role at all, and look perfectly correct in the table. Null here means
  -- the account does not exist yet, which is the case the trigger does cover.
  -- (This reads auth.users; it is why the function is security definer.)
  select id into v_auth_user_id
  from auth.users
  where raw_user_meta_data ->> 'provider_id' = p_discord_id
  limit 1;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id and discord_id = p_discord_id
  for update;

  if not found then
    insert into public.team_members (team_id, discord_id, auth_user_id, role)
    values (p_team_id, p_discord_id, v_auth_user_id, p_role)
    returning id into v_id;

    perform public.write_audit_log(
      p_team_id, 'team_role_granted', 'team_member', v_id,
      jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null)
    );

    return v_auth_user_id;
  end if;

  -- An existing row is never rewritten. `role` drives every team role helper
  -- and a wide slice of the read rules, so a conflict branch that overwrote it
  -- would let one mistyped Discord id demote a sitting team leader, with the
  -- audit entry reading like a fresh grant. Changing somebody's role stays
  -- with the promote path in the officer dashboard.
  if v_existing.role is distinct from p_role then
    raise exception 'That Discord account already has the % role on this team. Change a role through the promote path, not this grant.', v_existing.role;
  end if;

  if v_existing.auth_user_id is not null then
    raise exception 'That Discord account already has the % role on this team.', v_existing.role;
  end if;

  if v_auth_user_id is null then
    raise exception 'That Discord account already has the % role on this team, and no account exists for it to link to yet.', v_existing.role;
  end if;

  -- The repair: same role, and the link that was never made. This is the one
  -- case where re-granting writes anything.
  update public.team_members
  set auth_user_id = v_auth_user_id
  where id = v_existing.id;

  perform public.write_audit_log(
    p_team_id, 'team_role_relinked', 'team_member', v_existing.id,
    jsonb_build_object('discord_id', p_discord_id, 'role', v_existing.role)
  );

  return v_auth_user_id;
end;
$function$;
