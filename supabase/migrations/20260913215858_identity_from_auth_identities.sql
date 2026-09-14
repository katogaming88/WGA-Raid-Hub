-- #1135: identity resolves from auth.identities, not from user metadata.
--
-- GoTrue writes a Discord account's snowflake into two places at sign-in:
-- auth.identities.provider_id, which only the provider writes, and
-- auth.users.raw_user_meta_data ->> 'provider_id', which the account itself can
-- rewrite through PUT /auth/v1/user. Two records of one fact, one of them
-- forgeable, and the schema has been reading the forgeable one.
--
-- #1117 (claim_character refusing a linked row) and #1118 (the link trigger
-- requiring a Discord provider) closed the two routes that reached a grant
-- through it. Both narrow the surface. This retires the read.
--
-- We cannot stop GoTrue writing the metadata copy, so the job is to make it
-- non-authoritative: nothing here reads it, and tests/rls/function-invariants
-- refuses a new reader. What is left of it is display data.
--
-- Everything funnels through two functions, so the six consumers that already
-- call current_discord_id() change by inheriting: the boe_items and
-- boe_listings raider read policies, submit_boe_found()'s finder stamp, and
-- resolve_person()'s is-self gate (#1121). The provider string 'discord'
-- appears in this file and nowhere else in the schema, which is what #659 asks
-- for: if Battle.net ever replaces Discord login, this is the edit.
--
-- Measured on production 2026-09-13, before this ships: 73 accounts, 73
-- identity rows, every one discord, no account missing one, no duplicate
-- provider_id, and zero accounts whose metadata disagrees with their identity
-- row. So this changes the answer for nobody and needs no backfill.

-- The caller's Discord id, from the row the provider wrote.
--
-- No `limit 1`. One identity per provider per user is GoTrue's rule, enforced
-- at its API (identity_already_exists) rather than by a constraint here, so a
-- limit would imply a choice this function is entitled to make and it is not:
-- if that invariant ever broke, two rows would be a real problem to see rather
-- than one to silently paper over.
create or replace function public.current_discord_id() returns text
language sql stable security definer set search_path to 'public'
as $$
  select i.provider_id
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'discord';
$$;

comment on function public.current_discord_id() is
  'The caller''s Discord id from auth.identities (provider = discord); null for anon or an account with no Discord identity (#889, #1135). Reads the row the OAuth exchange writes, not raw_user_meta_data, which the account can rewrite. Gates the raider read of their own BoE finds.';

revoke all on function public.current_discord_id() from public;
grant execute on function public.current_discord_id() to anon, authenticated;

-- The reverse direction, for the grant RPCs: which account holds this Discord
-- id. Exact rather than a guess, because identities_provider_id_provider_unique
-- is a real unique constraint on (provider_id, provider), which is why the
-- callers below drop the `limit 1` they used to carry.
--
-- Granted to nobody: it reads auth.identities and is called only from inside
-- the security definer RPCs below. tests/rls/function-invariants asserts the
-- exact set of definer functions anon may execute, so granting it would turn
-- that red.
create or replace function public.auth_user_for_discord_id(p_discord_id text) returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select i.user_id
  from auth.identities i
  where i.provider_id = p_discord_id and i.provider = 'discord';
$$;

comment on function public.auth_user_for_discord_id(text) is
  'The account holding this Discord id, from auth.identities (#1135). Exact: (provider_id, provider) is unique. Null when no Discord account holds it, which is the "granted before their first sign-in" case the link trigger covers later.';

revoke all on function public.auth_user_for_discord_id(text) from public;

-- claim_character: the #1117 body, with the metadata read replaced by
-- current_discord_id() and a refusal when the caller has no Discord identity.
--
-- That refusal is new wording on a path that already failed:
-- team_members.discord_id is NOT NULL, so an account with nothing to resolve
-- used to reach the insert and die on the constraint. Saying so is clearer than
-- a 23502 in the browser console.
create or replace function public.claim_character(p_team_id integer, p_name_realm text)
returns table(name_realm text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_member_id integer;
  v_member_role text;
  v_member_auth_user_id uuid;
  v_discord_id text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The target character must be an active roster member of this team.
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id
    and p.name_realm = p_name_realm
    and p.archived_at is null;
  if v_player_id is null then
    raise exception 'Character not found on roster';
  end if;

  -- Find the caller's person row: by auth link first, then by an unlinked
  -- Discord id (a row imported from the claims sheet, #338, that the login
  -- trigger has not linked yet), otherwise create it. Reusing the discord_id
  -- row avoids the team_members_team_id_discord_id_key unique violation a
  -- blind insert would hit.
  select tm.id, tm.role into v_member_id, v_member_role
  from public.team_members tm
  where tm.team_id = p_team_id and tm.auth_user_id = v_uid;

  if v_member_id is null then
    v_discord_id := public.current_discord_id();

    if v_discord_id is null then
      raise exception 'This account has no Discord identity to claim a character with';
    end if;

    select tm.id, tm.role, tm.auth_user_id
      into v_member_id, v_member_role, v_member_auth_user_id
    from public.team_members tm
    where tm.team_id = p_team_id and tm.discord_id = v_discord_id;

    -- Someone already holds this row. Since #1135 the caller's Discord id comes
    -- from their identity row rather than from metadata they can write, so this
    -- is now a genuine collision rather than the takeover #1117 was refusing.
    if v_member_id is not null and v_member_auth_user_id is not null then
      raise exception 'That Discord account is linked to a different account';
    end if;

    if v_member_id is null then
      insert into public.team_members (team_id, discord_id, auth_user_id, role)
      values (p_team_id, v_discord_id, v_uid, 'raider')
      returning id into v_member_id;
      v_member_role := 'raider';
    else
      update public.team_members tm set auth_user_id = v_uid
      where tm.id = v_member_id;
    end if;
  end if;

  -- Never silently take over a character already linked to someone. The guard
  -- rides on the write itself (team_member_id is null) rather than a separate
  -- prior select, so two concurrent claims on the same character cannot both
  -- pass a check and then both write under read-committed isolation: the second
  -- update matches no row and raises.
  update public.players p set team_member_id = v_member_id
  where p.id = v_player_id and p.team_member_id is null;

  if not found then
    raise exception '% is already claimed', p_name_realm;
  end if;

  return query select p_name_realm, v_member_role;
end;
$$;

revoke all on function public.claim_character(integer, text) from public;
revoke execute on function public.claim_character(integer, text) from anon;
grant execute on function public.claim_character(integer, text) to authenticated;

-- The four grant RPCs. Each carried the same
-- `(select id from auth.users where raw_user_meta_data ->> 'provider_id' = ...
--   limit 1)`
-- and each becomes one call. Bodies are otherwise verbatim.

create or replace function public.admin_grant_site_admin(p_discord_id text) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.site_admins where discord_id = p_discord_id) then
    raise exception 'That Discord account already has site admin access';
  end if;

  insert into public.site_admins (discord_id, auth_user_id)
  values (p_discord_id, public.auth_user_for_discord_id(p_discord_id))
  returning id into v_id;

  perform public.write_audit_log(null, 'site_admin_granted', 'site_admin', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_grant_guild_officer(p_discord_id text) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.guild_officers where discord_id = p_discord_id) then
    raise exception 'That Discord account already has guild officer access';
  end if;

  insert into public.guild_officers (discord_id, auth_user_id)
  values (p_discord_id, public.auth_user_for_discord_id(p_discord_id))
  returning id into v_id;

  perform public.write_audit_log(null, 'guild_officer_granted', 'guild_officer', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_grant_boe_manager(p_discord_id text) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.boe_managers where discord_id = p_discord_id) then
    raise exception 'That Discord account already has BoE manager access';
  end if;

  insert into public.boe_managers (discord_id, auth_user_id)
  values (p_discord_id, public.auth_user_for_discord_id(p_discord_id))
  returning id into v_id;

  perform public.write_audit_log(null, 'boe_manager_granted', 'boe_manager', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_grant_team_role(p_team_id integer, p_discord_id text, p_role text) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
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

  -- Resolved here rather than left for a trigger to fill later. The link
  -- trigger fires on the account's Discord identity appearing, which happens
  -- once: a row inserted for somebody who signed in months ago would keep a
  -- null auth_user_id, read as no role at all, and look perfectly correct in
  -- the table. Null here means no Discord account holds that id yet, which is
  -- the case the trigger does cover.
  v_auth_user_id := public.auth_user_for_discord_id(p_discord_id);

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
$$;
