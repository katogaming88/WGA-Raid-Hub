-- Function public.rebuild_team_raid_progress: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.rebuild_team_raid_progress(p_team_id integer)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with fights as (
    select f.encounter_id, f.difficulty, f.kill, f.boss_percentage, f.report_code, f.fight_id,
           f.started_at, f.ended_at,
           r.raid_date, r.started_at as report_started_at,
           (r.missing_since is not null) as missing
      from team_raid_fights f
      join team_raid_reports r on r.team_id = f.team_id and r.report_code = f.report_code
     where f.team_id = p_team_id
       and r.effective_kind = 'main'
  ),
  -- Every overlapping pair across two reports, with how long they overlap.
  pairs as (
    select a.report_code as a_report, a.fight_id as a_fight,
           b.report_code as b_report, b.fight_id as b_fight,
           least(a.ended_at, b.ended_at) - greatest(a.started_at, b.started_at) as overlap,
           (not b.kill, b.missing, b.report_started_at, b.report_code, b.fight_id)
             < (not a.kill, a.missing, a.report_started_at, a.report_code, a.fight_id) as b_first
      from fights a
      join fights b
        on b.encounter_id = a.encounter_id
       and b.difficulty = a.difficulty
       and b.report_code <> a.report_code
       and b.started_at <= a.ended_at
       and a.started_at <= b.ended_at
  ),
  -- Each fight's best match in each other report.
  best as (
    select *
      from (select p.*,
                   row_number() over (partition by a_report, a_fight, b_report
                                      order by overlap desc, b_fight) as n
              from pairs p) ranked
     where n = 1
  ),
  -- ponytail: overlap in time decides a copy, so two loggers whose PC clocks
  -- differ by more than a pull's length count it twice; match on WCL's
  -- fight details if that turns up.
  main as (
    select f.*
      from fights f
     where not exists (
       select 1
         from best x
         join best y
           on y.a_report = x.b_report and y.a_fight = x.b_fight
          and y.b_report = x.a_report and y.b_fight = x.a_fight
        where x.a_report = f.report_code
          and x.a_fight = f.fight_id
          and x.b_first
     )
  ),
  agg as (
    select encounter_id, difficulty,
           count(*)::integer as pulls,
           (array_agg(raid_date order by report_started_at, fight_id) filter (where kill))[1] as kill_date,
           (array_agg(report_code order by report_started_at, fight_id) filter (where kill))[1] as kill_report,
           (array_agg(fight_id order by report_started_at, fight_id) filter (where kill))[1] as kill_fight,
           min(boss_percentage) filter (where not kill) as best_pct,
           (array_agg(report_code order by boss_percentage, report_started_at, fight_id)
              filter (where not kill and boss_percentage is not null))[1] as best_report,
           (array_agg(fight_id order by boss_percentage, report_started_at, fight_id)
              filter (where not kill and boss_percentage is not null))[1] as best_fight
      from main
     group by encounter_id, difficulty
  )
  insert into team_raid_progress (
    team_id, encounter_id,
    mythic_date, mythic_pulls, mythic_best_pct, mythic_report_code, mythic_fight_id,
    heroic_date, heroic_pulls, heroic_best_pct, heroic_report_code, heroic_fight_id,
    updated_at
  )
  select p_team_id, b.encounter_id,
         m.kill_date, coalesce(m.pulls, 0), case when m.kill_date is null then m.best_pct end,
         coalesce(m.kill_report, m.best_report), coalesce(m.kill_fight, m.best_fight),
         h.kill_date, coalesce(h.pulls, 0), case when h.kill_date is null then h.best_pct end,
         coalesce(h.kill_report, h.best_report), coalesce(h.kill_fight, h.best_fight),
         now()
    from (select distinct encounter_id from team_raid_fights where team_id = p_team_id) b
    left join agg m on m.encounter_id = b.encounter_id and m.difficulty = 'mythic'
    left join agg h on h.encounter_id = b.encounter_id and h.difficulty = 'heroic'
  on conflict (team_id, encounter_id) do update set
    mythic_date = excluded.mythic_date,
    mythic_pulls = excluded.mythic_pulls,
    mythic_best_pct = excluded.mythic_best_pct,
    mythic_report_code = excluded.mythic_report_code,
    mythic_fight_id = excluded.mythic_fight_id,
    heroic_date = excluded.heroic_date,
    heroic_pulls = excluded.heroic_pulls,
    heroic_best_pct = excluded.heroic_best_pct,
    heroic_report_code = excluded.heroic_report_code,
    heroic_fight_id = excluded.heroic_fight_id,
    updated_at = excluded.updated_at;
$function$;
