-- Actor-name resolution for audit log entries (#376, split from #215).
--
-- audit_log.actor_id is a bare auth.users uuid; nothing today resolves an
-- arbitrary actor to a display name the way resolveDiscordSession()
-- (js/discord.js) does for the logged-in user's own row. This is the harder
-- case: a site admin acting on a team they don't belong to has no
-- team_members row there at all, so the only name left is their Discord
-- display name, which lives in auth.users.raw_user_meta_data and is not
-- exposed to anon/authenticated. Same SECURITY DEFINER shape as
-- write_audit_log()/is_site_admin() (#214): plpgsql, set search_path to
-- 'public'.
--
-- Resolution order, mirroring resolveDiscordSession()'s own priority
-- (linked player over team_members' legacy name_realm bridge column):
--   1. players.nickname for the character team_members.auth_user_id links to
--      on this team
--   2. the character-name part of that player's name_realm (or, if no
--      player is linked, the team_members.name_realm bridge column)
--   3. auth.users.raw_user_meta_data's Discord display name (full_name,
--      falling back to name -- same keys resolveDiscordSession() reads
--      client-side from the session's user_metadata)
--   4. null, if the actor uuid isn't found anywhere
--
-- Gated the same as "Officers read audit_log": only a caller who could
-- already read this team's audit log should be able to resolve names on it,
-- since case 3 surfaces another person's Discord display name.
create or replace function public.resolve_actor_name(p_actor_id uuid, p_team_id integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id integer;
  v_tm_name_realm text;
  v_player_name_realm text;
  v_nickname text;
  v_display text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select tm.id, tm.name_realm into v_member_id, v_tm_name_realm
  from public.team_members tm
  where tm.team_id = p_team_id and tm.auth_user_id = p_actor_id;

  if v_member_id is not null then
    select p.nickname, p.name_realm into v_nickname, v_player_name_realm
    from public.players p
    where p.team_member_id = v_member_id
      and p.archived_at is null
    order by p.name_realm
    limit 1;

    if v_nickname is not null and v_nickname <> '' then
      return v_nickname;
    end if;

    if coalesce(v_player_name_realm, v_tm_name_realm) is not null then
      return split_part(coalesce(v_player_name_realm, v_tm_name_realm), '-', 1);
    end if;
  end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_display
  from auth.users u
  where u.id = p_actor_id;

  return v_display;
end;
$$;

revoke all on function public.resolve_actor_name(uuid, integer) from public;
revoke execute on function public.resolve_actor_name(uuid, integer) from anon;
grant execute on function public.resolve_actor_name(uuid, integer) to authenticated;
