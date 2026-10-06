-- Function public.skip_killed_bosses: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.skip_killed_bosses(p_kill_ids integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
  v_count integer;
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from team_raid_kills where id = any (p_kill_ids) order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  with first_kills as (
    -- The earliest of these kills per team, boss, difficulty and lockout, when
    -- no other kill of that boss is stored for the lockout.
    select distinct on (k.team_id, k.encounter_id, k.difficulty, lockout_week_start(k.raid_date))
           k.id, k.team_id, k.encounter_id, k.difficulty, k.raid_date, k.report_code
    from team_raid_kills k
    where k.id = any (p_kill_ids)
      and not exists (
        select 1 from team_raid_kills o
        where o.team_id = k.team_id and o.encounter_id = k.encounter_id and o.difficulty = k.difficulty
          and lockout_week_start(o.raid_date) = lockout_week_start(k.raid_date)
          and not (o.id = any (p_kill_ids))
      )
    order by k.team_id, k.encounter_id, k.difficulty, lockout_week_start(k.raid_date), k.report_started_at, k.fight_id
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.id
      from first_kills f
     where b.team_id = f.team_id
       and b.encounter_id = f.encounter_id
       and b.raid_date > f.raid_date
       and b.raid_date >= raid_today()
       and lockout_week_start(b.raid_date) = lockout_week_start(f.raid_date)
       and b.confirmed_at is null
       and not b.skipped
       and (select i.difficulty from raid_night_info(b.team_id, b.raid_date) i) = f.difficulty
    returning b.team_id, b.raid_date, b.encounter_id, f.raid_date as killed_on, f.difficulty, f.report_code
  ),
  cleared as (
    delete from raid_night_lineups l
    using skipped s
    where l.team_id = s.team_id and l.raid_date = s.raid_date and l.encounter_id = s.encounter_id
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select s.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', s.encounter_id,
         jsonb_build_object('raid_date', s.raid_date, 'boss', e.name, 'killed_on', s.killed_on,
                            'difficulty', s.difficulty, 'report_code', s.report_code)
  from skipped s
  join raid_encounters e on e.id = s.encounter_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
