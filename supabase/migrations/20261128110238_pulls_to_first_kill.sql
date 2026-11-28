-- #1955: the progression card counts a boss's pulls up to its first kill, not
-- every pull ever logged.
--
-- A boss the team keeps killing kept gaining pulls: Phoenix's Mythic Nek'zali
-- read "Killed Sep 15, 5 pulls" though it died on the third, the other two
-- being the next week's farm. The count says how long a boss took, so pulls
-- that start after the first kill no longer count. A boss that is not dead
-- yet counts every pull, as before. The pull chart (#1474) stops at the first
-- kill the same way, so the two agree.
--
-- The first kill is now the earliest kill by when the pull started, the order
-- the chart draws in; it was the earliest by report start, then fight id,
-- which only differs when two reports' pulls interleave. Everything else is
-- unchanged from 20261127222542_team_raid_pulls.sql.

create or replace function public.rebuild_team_raid_progress(p_team_id integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  kept team_raid_fights[];
begin
  kept := array(select f from team_main_pulls(p_team_id) f);

  with pulls as (
    select f2.encounter_id, f2.difficulty, f2.kill, f2.boss_percentage, f2.report_code, f2.fight_id,
           f2.started_at, r.raid_date,
           min(f2.started_at) filter (where f2.kill) over (partition by f2.encounter_id, f2.difficulty) as first_kill_at
      from unnest(kept) f2
      join team_raid_reports r on r.team_id = p_team_id and r.report_code = f2.report_code
  ),
  main as (
    select * from pulls where first_kill_at is null or started_at <= first_kill_at
  ),
  agg as (
    select encounter_id, difficulty,
           count(*)::integer as pulls,
           (array_agg(raid_date order by started_at, report_code, fight_id) filter (where kill))[1] as kill_date,
           (array_agg(report_code order by started_at, report_code, fight_id) filter (where kill))[1] as kill_report,
           (array_agg(fight_id order by started_at, report_code, fight_id) filter (where kill))[1] as kill_fight,
           min(boss_percentage) filter (where not kill) as best_pct,
           (array_agg(report_code order by boss_percentage, started_at, fight_id)
              filter (where not kill and boss_percentage is not null))[1] as best_report,
           (array_agg(fight_id order by boss_percentage, started_at, fight_id)
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
$$;

comment on function public.rebuild_team_raid_progress(integer) is
  'Rebuilds a team''s team_raid_progress rows from team_raid_fights, counting the fights of its main reports, a report Warcraft Logs no longer returns included, and each pull once when two reports overlap on it (#1470, #1938). A killed boss counts its pulls up to the first kill, not later farm pulls (#1955). Called by wcl-progression-sync after it writes the fights, and by an officer''s change to a report (#1472).';

comment on column public.team_raid_progress.mythic_pulls is
  'Mythic pulls of this boss from the team''s main reports, each pull once; once the boss is killed, only the pulls up to the first kill (#1955).';
comment on column public.team_raid_progress.heroic_pulls is
  'Heroic pulls of this boss from the team''s main reports, each pull once; once the boss is killed, only the pulls up to the first kill (#1955).';

-- Every team's card now, rather than at its next sync.
do $$
declare
  t integer;
begin
  for t in select distinct team_id from team_raid_fights loop
    perform rebuild_team_raid_progress(t);
  end loop;
end;
$$;
