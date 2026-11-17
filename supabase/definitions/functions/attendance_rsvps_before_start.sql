-- Function public.attendance_rsvps_before_start: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.attendance_rsvps_before_start(p_team_id integer, p_dates date[])
 RETURNS TABLE(player_id integer, raid_date date, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;
    if not (public.has_team_permission(p_team_id, 'attendance') or public.is_site_admin()) then
      raise exception 'Not authorized';
    end if;
  end if;

  return query
  select r.player_id, r.raid_date, r.status
  from public.raid_rsvps r
  cross join lateral public.raid_night_info(r.team_id, r.raid_date) n
  where r.team_id = p_team_id
    and r.raid_date = any (p_dates)
    and n."exists"
    and r.updated_at < ((r.raid_date + n.start_time) at time zone n.timezone);
end;
$function$;
