-- #1117: claim_character() refuses a team_members row that already belongs to
-- another account.
--
-- The fallback branch resolves the caller's Discord id from
-- auth.users.raw_user_meta_data, a column the account itself can write, and
-- then sets auth_user_id on whatever row it found on that team. Nothing checked
-- the row was unlinked, so a caller who put another person's Discord id in
-- their own metadata took that person's row, and its role, away from them.
--
-- The guard is one extra column on the select that already runs. An unlinked
-- row is still adopted: that is the claims-sheet import path (#338) the
-- fallback exists for, and the case a blind insert cannot serve because of
-- team_members_team_id_discord_id_key. A row belonging to somebody else raises
-- instead of falling through to the insert, which would hit that same unique
-- constraint and report a confusing error.
--
-- This closes one of two routes to the same outcome. The other,
-- link_auth_user_to_member() acting on unverified signup metadata, is #1118.
-- Reading identity from auth.identities rather than metadata is the full fix
-- and is tracked separately; until then the BoE read policies, submit_boe_found
-- and the four admin_grant_* RPCs still resolve identity from this column.

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
    select u.raw_user_meta_data ->> 'provider_id' into v_discord_id
    from auth.users u where u.id = v_uid;

    select tm.id, tm.role, tm.auth_user_id
      into v_member_id, v_member_role, v_member_auth_user_id
    from public.team_members tm
    where tm.team_id = p_team_id and tm.discord_id = v_discord_id;

    -- Someone already holds this row. The caller reached it by carrying that
    -- person's Discord id, which proves nothing, so refuse rather than relink.
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
