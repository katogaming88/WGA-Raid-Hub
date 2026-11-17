-- Function public.attendance_rsvps_before_start: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.attendance_rsvps_before_start(p_team_id integer, p_dates date[])
 RETURNS TABLE(player_id integer, raid_date date, status text, note text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select r.player_id, r.raid_date, r.status, r.note
  from public.raid_rsvps r
  cross join lateral public.raid_night_info(r.team_id, r.raid_date) n
  where r.team_id = p_team_id
    and r.raid_date = any (p_dates)
    and n."exists"
    and r.updated_at < ((r.raid_date + n.start_time) at time zone n.timezone)
$function$;
