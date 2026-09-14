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
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin or public.is_guild_officer();

  if not (v_sees_all_teams or public.is_any_team_officer()) then
    raise exception 'Not authorized';
  end if;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where discord_id = p_discord_id)
       or exists (select 1 from site_admins where discord_id = p_discord_id)
       or exists (select 1 from guild_officers where discord_id = p_discord_id)
       or exists (select 1 from boe_managers where discord_id = p_discord_id)
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', coalesce(
      (select tm.auth_user_id from team_members tm where tm.discord_id = p_discord_id and tm.auth_user_id is not null limit 1),
      (select sa.auth_user_id from site_admins sa where sa.discord_id = p_discord_id),
      (select go.auth_user_id from guild_officers go where go.discord_id = p_discord_id),
      (select bm.auth_user_id from boe_managers bm where bm.discord_id = p_discord_id)
    ),
    'site_admin', case when v_is_self or v_is_site_admin
                       then exists (select 1 from site_admins where discord_id = p_discord_id) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then exists (select 1 from guild_officers where discord_id = p_discord_id) end,
    'boe_manager', exists (select 1 from boe_managers where discord_id = p_discord_id),
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
