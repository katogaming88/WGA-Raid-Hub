-- Function public.set_team_discord_quiet_hours: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_discord_quiet_hours(p_team_id integer, p_start time without time zone, p_end time without time zone, p_timezone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_config;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if num_nonnulls(p_start, p_end, p_timezone) not in (0, 3) then
    raise exception 'Quiet hours need a start, an end and a time zone, or none of them for off';
  end if;
  if p_start = p_end then
    raise exception 'Quiet hours start and end at different times';
  end if;
  if p_timezone is not null and not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
    raise exception 'That is not a time zone';
  end if;

  select * into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;
  if v_old.quiet_hours_start is not distinct from p_start
     and v_old.quiet_hours_end is not distinct from p_end
     and v_old.quiet_hours_timezone is not distinct from p_timezone then
    return;
  end if;

  update team_discord_config
     set quiet_hours_start = p_start, quiet_hours_end = p_end, quiet_hours_timezone = p_timezone,
         updated_at = now()
   where team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Quiet Hours Set', 'teams', p_team_id,
          jsonb_build_object(
            'from', case when v_old.quiet_hours_start is null then null else jsonb_build_object(
              'start', v_old.quiet_hours_start, 'end', v_old.quiet_hours_end, 'timezone', v_old.quiet_hours_timezone) end,
            'to', case when p_start is null then null else jsonb_build_object(
              'start', p_start, 'end', p_end, 'timezone', p_timezone) end));
end;
$function$;
