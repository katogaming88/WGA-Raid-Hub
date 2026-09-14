-- #752: the officer gates in direct_mark_received, admin_grant_team_role and
-- admin_revoke_team_role refuse a caller with no row on the team.
--
-- my_team_role(p_team_id) is null for a caller who holds no team_members row
-- on that team, and each of these three gates compared it bare:
-- `null = 'team_leader'` is null, `not (false or null)` is null, and
-- `if null then raise` never raises. Every sibling gate wraps the comparison
-- in coalesce(..., false); these three did not, and each let a caller with
-- no standing on the team through. Measured on 2026-09-14: an officer on
-- another team, or an account with no role anywhere, marked a raider's item
-- received as approved; an account with no role anywhere granted itself
-- team_leader on a team, because the audit-log gate that follows the insert
-- then saw it as that team's leader; a BoE manager granted, and a guild
-- officer revoked, on teams they held no row on, because write_audit_log()
-- admits those tiers on its own. Production's audit log shows one grant
-- since the path landed, by a site admin.
--
-- One line changes in each function; the bodies are otherwise as
-- 20260725100000_self_received_bis_obtained (direct_mark_received),
-- 20260904052807_team_role_grant (admin_revoke_team_role) and
-- 20260913215858_identity_from_auth_identities (admin_grant_team_role) left
-- them. my_team_role() keeps returning null for no row: 22 callers, the
-- #1106 rule helpers and the policies read it that way. The gate is where
-- the null is settled, and tests/rls/function-invariants.test.js T6 now
-- fails any function body that compares my_team_role() without coalesce.

create or replace function public.direct_mark_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_source text default null,
  p_note text default null,
  p_slot text default null
) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_request_id integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $$;

create or replace function public.admin_grant_team_role(p_team_id integer, p_discord_id text, p_role text) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
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

create or replace function public.admin_revoke_team_role(p_team_id integer, p_discord_id text) returns void
language plpgsql security definer set search_path to 'public'
as $$
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
$$;
