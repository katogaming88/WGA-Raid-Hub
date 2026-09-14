-- Function public.team_battlenet_connections: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_battlenet_connections(p_team_id integer)
 RETURNS TABLE(team_member_id integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
