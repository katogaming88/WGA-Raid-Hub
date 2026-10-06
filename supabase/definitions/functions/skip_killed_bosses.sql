-- Function public.skip_killed_bosses: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.skip_killed_bosses()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from new_kills order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  with nights as (
    select b.id, b.team_id, b.raid_date, b.encounter_id,
           (select i.difficulty from raid_night_info(b.team_id, b.raid_date) i) as difficulty
    from raid_night_bosses b
    where (b.team_id, b.encounter_id) in (select team_id, encounter_id from new_kills)
      and b.raid_date >= raid_today()
      and b.confirmed_at is null
      and not b.skipped
  ),
  first_kills as (
    -- Only when every kill of the boss before the night arrived in this
    -- insert: another log of a kill already counted changes nothing.
    select n.id as night_id, (array_agg(k.id order by k.report_started_at, k.fight_id))[1] as kill_id
    from nights n
    cross join lateral kills_before_night(n.team_id, n.encounter_id, n.raid_date, n.difficulty) k
    left join new_kills nk on nk.id = k.id
    group by n.id
    having bool_and(nk.id is not null)
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.kill_id
      from first_kills f
     where b.id = f.night_id
    returning b.team_id, b.raid_date, b.encounter_id, b.skipped_for_kill_id
  ),
  cleared as (
    delete from raid_night_lineups l
    using skipped s
    where l.team_id = s.team_id and l.raid_date = s.raid_date and l.encounter_id = s.encounter_id
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select s.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', s.encounter_id,
         jsonb_build_object('raid_date', s.raid_date, 'boss', e.name, 'killed_on', k.raid_date,
                            'difficulty', k.difficulty, 'report_code', k.report_code)
  from skipped s
  join team_raid_kills k on k.id = s.skipped_for_kill_id
  join raid_encounters e on e.id = s.encounter_id;

  return null;
end;
$function$;
