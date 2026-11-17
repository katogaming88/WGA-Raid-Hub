-- #1484: officers see which Battle.net and Discord account each team member
-- connected, not only whether they did, so a wrong or stale link shows at a
-- glance on the Roster. team_member_accounts() answers it for the team's
-- current members, with team_battlenet_connections()' check: edit_roster on
-- the team, or a site admin. team_battlenet_connections() stays for the
-- current site.
--
-- Discord counts as linked by team_members.discord_id, as the Roster already
-- reads it; the username comes from the Discord sign-in, full_name being the
-- username (name carries a "#0" on the new usernames).

create or replace function public.team_member_accounts(p_team_id integer)
returns table (
  team_member_id integer,
  battlenet boolean,
  battletag text,
  discord boolean,
  discord_username text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    bn.user_id is not null,
    nullif(bn.identity_data -> 'custom_claims' ->> 'battletag', ''),
    tm.discord_id is not null,
    coalesce(
      nullif(dc.identity_data ->> 'full_name', ''),
      nullif(regexp_replace(dc.identity_data ->> 'name', '#0$', ''), '')
    )
  from public.team_members tm
  left join public.people pe on pe.id = tm.person_id
  left join lateral (
    select i.user_id, i.identity_data
    from auth.identities i
    where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
    order by i.created_at desc
    limit 1
  ) bn on true
  left join lateral (
    select i.identity_data
    from auth.identities i
    where i.user_id = pe.auth_user_id and i.provider = 'discord'
    order by i.created_at desc
    limit 1
  ) dc on true
  where tm.team_id = p_team_id
    and tm.archived_at is null
  order by tm.id;
end;
$$;

comment on function public.team_member_accounts(integer) is
  'Each current team member''s Battle.net and Discord accounts for the Roster (#1484): whether each is linked, the BattleTag and the Discord username (null when not connected or not on record). edit_roster on the team, or a site admin.';

revoke all on function public.team_member_accounts(integer) from public;
revoke execute on function public.team_member_accounts(integer) from anon;
grant execute on function public.team_member_accounts(integer) to authenticated;
