-- Function public.resolve_person: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.resolve_person(p_discord_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  v_sees_all_teams boolean;
  v_person people%rowtype;
  v_grants text[];
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin or public.is_guild_officer();

  if not (v_sees_all_teams or public.is_any_team_officer()) then
    raise exception 'Not authorized';
  end if;

  select * into v_person from people where discord_id = p_discord_id;

  select coalesce(array_agg(g.grant_type), '{}') into v_grants
    from guild_grants g
   where g.person_id = v_person.id;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where discord_id = p_discord_id)
       or cardinality(v_grants) > 0
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', coalesce(
      (select tm.auth_user_id from team_members tm where tm.discord_id = p_discord_id and tm.auth_user_id is not null limit 1),
      case when cardinality(v_grants) > 0 then v_person.auth_user_id end
    ),
    'site_admin', case when v_is_self or v_is_site_admin
                       then 'site_admin' = any (v_grants) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then 'guild_officer' = any (v_grants) end,
    'boe_manager', 'boe_manager' = any (v_grants),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.discord_id = p_discord_id
         and (v_sees_all_teams or public.my_team_role(tm.team_id) = any (array['officer', 'team_leader']))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;
