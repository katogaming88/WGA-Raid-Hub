-- Function public.plan_raid_night: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.plan_raid_night(p_team_id integer, p_raid_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
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

  if not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  v_count := public.fill_raid_night(p_team_id, p_raid_date);

  if v_count > 0 then
    perform public.write_audit_log(
      p_team_id,
      'Plan Raid Night',
      'raid_night_bosses',
      null,
      jsonb_build_object('raid_date', p_raid_date, 'bosses', v_count)
    );
  end if;

  return v_count;
end;
$function$;
