-- Function public.team_main_pulls: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_main_pulls(p_team_id integer, p_encounter_id integer DEFAULT NULL::integer)
 RETURNS SETOF team_raid_fights
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  f team_raid_fights;
  boss_kept team_raid_fights[] := '{}'::team_raid_fights[];
  kept team_raid_fights[] := '{}'::team_raid_fights[];
  absorbed text[] := '{}'::text[];
  cur_boss integer;
  cur_diff text;
  m_report text;
  m_fight integer;
begin
  -- ponytail: overlap in time decides a copy, so two loggers whose PC clocks
  -- differ by more than half a pull count it twice, and by more than the gap
  -- to the next pull can pair the wrong pulls of a night; match on WCL's
  -- fight details if that turns up.
  for f in
    select fi.*
      from team_raid_fights fi
      join team_raid_reports r on r.team_id = fi.team_id and r.report_code = fi.report_code
     where fi.team_id = p_team_id
       and (p_encounter_id is null or fi.encounter_id = p_encounter_id)
       and r.effective_kind = 'main'
     order by fi.encounter_id, fi.difficulty,
              not fi.kill, coalesce(fi.boss_percentage, 101), r.missing_since is not null,
              r.started_at, fi.report_code, fi.fight_id
  loop
    if cur_boss is distinct from f.encounter_id or cur_diff is distinct from f.difficulty then
      kept := kept || boss_kept;
      boss_kept := '{}'::team_raid_fights[];
      cur_boss := f.encounter_id;
      cur_diff := f.difficulty;
    end if;
    select k.report_code, k.fight_id into m_report, m_fight
      from unnest(boss_kept) k
     where k.report_code <> f.report_code
       and k.started_at <= f.ended_at
       and f.started_at <= k.ended_at
       and 2 * (least(f.ended_at, k.ended_at) - greatest(f.started_at, k.started_at))
         >= least(f.ended_at - f.started_at, k.ended_at - k.started_at)
       and not (k.report_code || '/' || k.fight_id || '/' || f.report_code = any (absorbed))
     order by least(f.ended_at, k.ended_at) - greatest(f.started_at, k.started_at) desc,
              k.report_code, k.fight_id
     limit 1;
    if found then
      absorbed := absorbed || (m_report || '/' || m_fight || '/' || f.report_code);
    else
      boss_kept := boss_kept || f;
    end if;
  end loop;
  kept := kept || boss_kept;

  return query select * from unnest(kept);
end;
$function$;
