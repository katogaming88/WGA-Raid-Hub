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
  v_skipped integer[];
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from new_kills order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  -- A night already under way is left alone: tonight counts until its
  -- scheduled start, and a night with no start time counts as started.
  with nights as (
    select b.id, b.team_id, b.raid_date, b.encounter_id, i.difficulty
    from raid_night_bosses b
    cross join lateral raid_night_info(b.team_id, b.raid_date) i
    where (b.team_id, b.encounter_id) in (select team_id, encounter_id from new_kills)
      and (b.raid_date > raid_today()
           or (b.raid_date = raid_today() and now() < (b.raid_date + i.start_time) at time zone i.timezone))
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
    returning b.id
  )
  select array_agg(id) into v_skipped from skipped;

  delete from raid_night_lineups l
  using raid_night_bosses b
  where b.id = any (v_skipped)
    and l.team_id = b.team_id and l.raid_date = b.raid_date and l.encounter_id = b.encounter_id;

  perform log_killed_boss_skips(v_skipped);

  return null;
end;
$function$;
