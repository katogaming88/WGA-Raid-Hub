-- #1403: a role grant brings someone archived off the team back with that
-- role, and a revoke refuses them.
--
-- Any action of an officer's or above brings an archived member back (Option 2
-- on #1355). The grant read an archived membership as a role still held and
-- refused it, naming a role that no longer counts. The revoke took the
-- archived row for a role to remove: it demoted it to raider, or deleted it
-- when nothing pointed at it.

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

comment on function public.admin_grant_team_role(integer, text, text) is
  'Grants a per-team role by Discord id. Site admins may grant on any team; a team leader only on their own, which means a team with no members can only be opened by a site admin. The membership''s account is the one the trigger copies from the person the Discord id names (#942, #1135), and the grant returns it. Refuses to change a role someone already holds on the team. Someone archived off the team holds none, so the grant brings them back with the granted role and logs team_member_restored as well (#1403; Option 2 on #1355); their characters stay archived. (#910)';

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
  where team_id = p_team_id
    and person_id = (select id from public.people where discord_id = p_discord_id)
  for update;

  if not found then
    raise exception 'That Discord account does not have a role on this team';
  end if;

  -- An archived membership holds no role, so there is nothing to take, and
  -- the row is kept as it is (#1403).
  if v_existing.archived_at is not null then
    raise exception 'That Discord account''s membership on this team has ended, so it has no role to remove';
  end if;

  -- players_team_member_id_fkey is ON DELETE SET NULL, so deleting a member a
  -- character points at would silently unclaim that character, with no error
  -- anywhere and nothing in the audit log saying it happened. Somebody who
  -- has claimed a character stays on the team as a raider instead, and so
  -- does somebody with a removal reason on record (#1427).
  select count(*) into v_claimed from public.players where team_member_id = v_existing.id;

  if v_claimed > 0 or exists (select 1 from public.removal_reasons where team_member_id = v_existing.id) then
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

comment on function public.admin_revoke_team_role(integer, text) is
  'Removes a per-team role by Discord id. Demotes to raider when any character is claimed against the member, because the foreign key from players is ON DELETE SET NULL and a delete would silently unclaim it, or when a removal reason points at the membership (#1427); removes the row only when nothing points at it. Refuses someone archived off the team, who holds no role, saying their membership has ended, and leaves it as it is (#1403). (#910)';

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared when they are brought back: team_invite_link_join(); restore_team_member(), as a raider, when an officer adds their season signup (#1402) or re-adds one of their characters on the Roster tab (restore_player(), #1133); or admin_grant_team_role(), with the role it grants, when the team leader or a site admin grants them one (#1403). Nothing changes it any other way: a direct update of the column is refused (team_members_archived_at_through_functions). Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row, and so does every "what does this person own there" read (is_own_player, my_active_player_ids, and the own-character lookups in request_main_swap, set_own_rsvp and submit_self_received, #1401), and admin_revoke_team_role() refuses one (#1403); my_player_ids() and earlier_characters() still read it, since that is the history.';

comment on function public.archive_team_member(integer, integer, text, text) is
  'Officer-only: archives a team_members row for someone who left (#1355), and their active characters with it, rather than deleting either -- players.team_member_id is ON DELETE SET NULL, so a delete would sever an archived character''s history and free it for the next Battle.net import to claim as theirs (Rex''s review, 2026-09-28). Records the reason (one of the six archive_player() takes) and the detail on each character it archives, in the audit entry with the archived character ids, and in removal_reasons, one row for the membership and one per character (#1427). An officer''s membership is archived only by the team leader or a site admin, the team leader''s only by a site admin. A second archive does nothing. The ways back are listed on team_members.archived_at.';
