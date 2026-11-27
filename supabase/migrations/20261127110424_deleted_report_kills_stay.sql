-- #1938: a kill stays on the progression card after its Warcraft Logs report
-- is deleted, and the same pull logged in two reports counts once.
--
-- #1470 left a report Warcraft Logs no longer returns (missing_since) out of
-- rebuild_team_raid_progress(), so deleting a duplicate, or deleting a log by
-- accident, could take a real kill off the card. Kat reversed that on
-- 2026-11-27: the kill happened, and a deleted log does not undo it. A missing
-- report now counts like any other.
--
-- Counting missing reports would make a deleted duplicate double the pull
-- count for good, so the rebuild now counts each pull once however many of
-- the team's main reports hold it. Two fights in two reports are the same
-- pull when they are on the same boss and difficulty and overlap for at
-- least half of the shorter one. Two raiders' logs of one pull overlap almost
-- end to end, and a log that joined late sits inside the other; a clock a few
-- seconds off only makes one log's pull touch the next pull in the other log,
-- well under half, so that next pull is not taken for a copy.
-- The copy kept is one that recorded the kill first (a log that stopped
-- early records the same pull as a wipe), then the one that saw the boss
-- lowest, so the best attempt is the truest one even if its log is gone (Kat,
-- 2026-11-27); then one from a report Warcraft Logs still returns, then the
-- earliest report, then the lowest report code and fight id, so the card
-- links to a log that still opens when the copies agree.
--
-- missing_since stays as the record of which reports are gone (#1472 and
-- #1473 may show it); it no longer changes what counts.

create or replace function public.rebuild_team_raid_progress(p_team_id integer)
returns void
language sql
set search_path = public
as $$
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
  -- A fight is a copy to drop when another report holds the same pull (they
  -- overlap for at least half of the shorter one) and that copy sorts first.
  -- ponytail: overlap in time decides a copy, so two loggers whose PC clocks
  -- differ by more than half a pull count it twice, and by more than the gap
  -- to the next pull can take a short log of that pull for a copy; match on WCL's fight
  -- details if that turns up.
  main as (
    select a.*
      from fights a
     where not exists (
       select 1
         from fights b
        where b.encounter_id = a.encounter_id
          and b.difficulty = a.difficulty
          and b.report_code <> a.report_code
          and b.started_at <= a.ended_at
          and a.started_at <= b.ended_at
          and 2 * (least(a.ended_at, b.ended_at) - greatest(a.started_at, b.started_at))
            >= least(a.ended_at - a.started_at, b.ended_at - b.started_at)
          and (not b.kill, coalesce(b.boss_percentage, 101), b.missing, b.report_started_at, b.report_code, b.fight_id)
            < (not a.kill, coalesce(a.boss_percentage, 101), a.missing, a.report_started_at, a.report_code, a.fight_id)
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
$$;

comment on function public.rebuild_team_raid_progress(integer) is
  'Rebuilds a team''s team_raid_progress rows from team_raid_fights, counting the fights of its main reports, a report Warcraft Logs no longer returns included, and each pull once when two reports overlap on it (#1470, #1938). Called by wcl-progression-sync after it writes the fights, and by an officer''s change to a report (#1472).';

comment on column public.team_raid_reports.missing_since is
  'When the sync first read the report''s window and Warcraft Logs did not return it (#1470): deleted, or made private. Null while it comes back. Its fights stay and still count on the progression card (#1938).';
