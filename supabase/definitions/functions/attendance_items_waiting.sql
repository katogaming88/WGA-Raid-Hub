-- Function public.attendance_items_waiting: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.attendance_items_waiting(p_team_id integer)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from public.attendance a
  where a.team_id = p_team_id
    and a.status is null
    and a.source in ('WCL (Late?)', 'WCL (Absent?)')
    and a.report_excluded = false
    and a.raid_date >= public.team_season_start(p_team_id)
$function$;
