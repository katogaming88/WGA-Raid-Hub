-- Function public.claim_character: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.claim_character(p_team_id integer, p_name_realm text)
 RETURNS TABLE(name_realm text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
