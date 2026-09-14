-- #1157: which of a team's members have connected Battle.net to their account.
--
-- The new app signs in with Battle.net, with Discord linked to the same account
-- (decision log, 2026-09-14). Everyone on the live site already has a Discord
-- account, and Supabase cannot merge two accounts, so people connect Battle.net
-- from the current site before the January cutover. Officers need to see who
-- has, to chase the rest.
--
-- Whether an account has a Battle.net identity lives in auth.identities, which
-- no client role can read, hence a definer function. It returns only member
-- ids: the claims table already has the names, and the Battle.net account id
-- and BattleTag are not needed to answer "connected or not".
--
-- The same people who see the claims table may ask: the team's officers and
-- leader, a site admin, and a guild officer (#607 gives them roster edits on
-- other teams).

create or replace function public.team_battlenet_connections(p_team_id integer)
returns table(team_member_id integer)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select tm.id
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.auth_user_id is not null
    and exists (
      select 1
      from auth.identities i
      where i.user_id = tm.auth_user_id
        and i.provider = 'custom:battlenet'
    )
  order by tm.id;
end;
$$;

comment on function public.team_battlenet_connections(integer) is
  'Ids of the team''s members whose account has a Battle.net identity (custom:battlenet in auth.identities), for the officer claims table (#1157). Officers, team leader, site admin and guild officers only.';

revoke all on function public.team_battlenet_connections(integer) from public;
revoke execute on function public.team_battlenet_connections(integer) from anon;
grant execute on function public.team_battlenet_connections(integer) to authenticated;
