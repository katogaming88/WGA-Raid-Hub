-- Raider character claim (#212).
--
-- A raider logging in via Discord has a Supabase auth session but no role, so
-- they cannot write players or team_members under existing RLS. This
-- SECURITY DEFINER function performs the exact claim on their behalf: it links
-- the chosen character (a players row) to the person layer (a team_members
-- row), creating the team_members row on a first claim. Same definer pattern
-- as link_auth_user_to_member() and is_site_admin().
--
-- Canonical link is players.team_member_id (docs/database-decisions.md, #258):
-- players are characters, team_members is the person, the FK links them many
-- characters to one person. team_members.name_realm stays only as the legacy
-- bridge column the Discord Claims import filled (#338); it is not written here.
--
-- Implementation note: returns table(name_realm, role) makes those two names
-- OUT parameters, so every reference to the same-named table columns inside the
-- body is qualified (p.name_realm, tm.role) to avoid an ambiguous reference.

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

  -- Never silently take over a character already linked to someone.
  if exists (
    select 1 from public.players p
    where p.id = v_player_id and p.team_member_id is not null
  ) then
    raise exception '% is already claimed', p_name_realm;
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

    select tm.id, tm.role into v_member_id, v_member_role
    from public.team_members tm
    where tm.team_id = p_team_id and tm.discord_id = v_discord_id;

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

  update public.players p set team_member_id = v_member_id
  where p.id = v_player_id;

  return query select p_name_realm, v_member_role;
end;
$$;

revoke all on function public.claim_character(integer, text) from public;
revoke execute on function public.claim_character(integer, text) from anon;
grant execute on function public.claim_character(integer, text) to authenticated;

-- A raider can read their own team_members row once linked. Only officers,
-- team leaders, and site admins had a SELECT policy before, so
-- resolveDiscordSession()'s team_members read returned zero rows for a raider
-- (a blocked read, not "no row"), and nameRealm never resolved. auth.uid() is
-- null for anon, so this stays invisible to anonymous callers.
create policy "Members read own team_members" on public.team_members
  for select using (auth_user_id = auth.uid());

-- One-time backfill: link the pre-migrated claims to their characters. The
-- Discord Claims import (#338) filled team_members.name_realm for the existing
-- raider/team_leader claims; match each to its players row and set the
-- canonical team_member_id. Runs against existing production data; on a fresh
-- local or CI database the tables are still empty at migration time (seed.sql
-- loads afterward), so this is a no-op there.
update public.players p
   set team_member_id = tm.id
  from public.team_members tm
 where p.team_id = tm.team_id
   and p.name_realm = tm.name_realm
   and p.team_member_id is null;
