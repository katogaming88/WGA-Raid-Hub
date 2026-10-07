-- Function public.log_killed_boss_skips: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.log_killed_boss_skips(p_boss_ids integer[])
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select b.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', b.encounter_id,
         jsonb_build_object('raid_date', b.raid_date, 'boss', e.name, 'killed_on', k.raid_date,
                            'difficulty', k.difficulty, 'report_code', k.report_code)
  from raid_night_bosses b
  join team_raid_kills k on k.id = b.skipped_for_kill_id
  join raid_encounters e on e.id = b.encounter_id
  where b.id = any (p_boss_ids)
  order by b.raid_date, b.position;
$function$;
