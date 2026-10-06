-- Function public.kills_before_night: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.kills_before_night(p_team_id integer, p_encounter_id integer, p_raid_date date, p_difficulty text)
 RETURNS SETOF team_raid_kills
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select k.*
  from team_raid_kills k
  where k.team_id = p_team_id
    and k.encounter_id = p_encounter_id
    and k.difficulty = p_difficulty
    and k.raid_date >= lockout_week_start(p_raid_date)
    and k.raid_date < p_raid_date
    and lockout_start_at(k.report_started_at) = lockout_week_start(p_raid_date)
$function$;
