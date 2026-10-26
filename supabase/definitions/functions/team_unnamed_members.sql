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
  -- The same gate as team_battlenet_connections(): whoever can Assign.
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    (select coalesce(i.identity_data -> 'custom_claims' ->> 'global_name',
                     i.identity_data ->> 'full_name',
                     i.identity_data ->> 'name')
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'discord'
      limit 1),
    (select i.identity_data -> 'custom_claims' ->> 'battletag'
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
      limit 1),
    (select p.name_realm
       from public.players p
      where p.team_member_id = tm.id and p.archived_at is null
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
