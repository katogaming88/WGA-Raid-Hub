-- Function public.team_raid_pulls: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.team_raid_pulls(p_team_id integer, p_encounter_id integer)
 RETURNS TABLE(report_code text, fight_id integer, difficulty text, raid_date date, started_at timestamp with time zone, boss_percentage numeric, kill boolean, last_phase integer, last_phase_is_intermission boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select f.report_code, f.fight_id, f.difficulty, r.raid_date, f.started_at, f.boss_percentage, f.kill,
         f.last_phase, f.last_phase_is_intermission
    from team_main_pulls(p_team_id, p_encounter_id) f
    join team_raid_reports r on r.team_id = f.team_id and r.report_code = f.report_code
   order by f.started_at, f.report_code, f.fight_id
$function$;
