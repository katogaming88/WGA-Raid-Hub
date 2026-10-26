-- Function public.team_unnamed_members: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_unnamed_members(p_team_id integer)
 RETURNS TABLE(team_member_id integer, discord_name text, battletag text, character_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Whoever can Assign: the team's officers, a site admin, or a guild officer
  -- of this team's own guild. is_guild_officer() would answer for a guild
  -- officer anywhere and hand one guild's sign-in names to another (#1643's
  -- rule, CodeRabbit on this function).
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or exists (select 1 from public.teams t where t.id = p_team_id and public.is_guild_officer_of(t.guild_id))
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    -- An empty name counts as none, as the app reads its own sign-in.
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'discord'
      order by i.created_at desc
      limit 1),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'battletag', '')
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
      order by i.created_at desc
      limit 1),
    (select p.name_realm
       from public.players p
      -- On this team too, not only linked to the membership (CodeRabbit).
      where p.team_member_id = tm.id and p.team_id = tm.team_id and p.archived_at is null
      order by p.id
      limit 1)
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and tm.archived_at is null
    and not exists (select 1 from public.names n where n.team_member_id = tm.id)
  order by tm.id;
end;
$function$;
