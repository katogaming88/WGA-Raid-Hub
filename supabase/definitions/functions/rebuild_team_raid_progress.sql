-- Function public.rebuild_team_raid_progress: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.rebuild_team_raid_progress(p_team_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  kept team_raid_fights[];
begin
  kept := array(select f from team_main_pulls(p_team_id) f);

  with main as (
    select f2.encounter_id, f2.difficulty, f2.kill, f2.boss_percentage, f2.report_code, f2.fight_id,
           r.raid_date, r.started_at as report_started_at
      from unnest(kept) f2
      join team_raid_reports r on r.team_id = p_team_id and r.report_code = f2.report_code
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
end;
$function$;
