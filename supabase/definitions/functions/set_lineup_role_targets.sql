-- Function public.set_lineup_role_targets: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_lineup_role_targets(p_team_id integer, p_tanks integer, p_healers integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_tanks < 0 or p_tanks > 20 or p_healers < 0 or p_healers > 20 then
    raise exception 'Role targets have to be between 0 and 20.';
  end if;

  insert into team_lineup_settings (team_id, tanks_wanted, healers_wanted, updated_at)
  values (p_team_id, p_tanks, p_healers, now())
  on conflict (team_id) do update set tanks_wanted = excluded.tanks_wanted, healers_wanted = excluded.healers_wanted, updated_at = excluded.updated_at;

  perform public.write_audit_log(
    p_team_id,
    'Set Lineup Role Targets',
    'team_lineup_settings',
    p_team_id,
    jsonb_build_object('tanks_wanted', p_tanks, 'healers_wanted', p_healers)
  );
end;
$function$;
