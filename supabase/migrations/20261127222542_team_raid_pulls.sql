-- #1496: anyone can read a team's own raids' pulls through one function, for
-- the pull chart (#1474); the pulls table itself closes to the team.
--
-- team_raid_fights (#1470) shipped with a public read, alt runs included, so
-- anyone could read an alt run's pulls under the team's name. Nothing on the
-- site reads it yet (only the progression sync writes it), and the chart is
-- the one public reader planned. So the table is now read as
-- team_raid_reports is: the team's raiders, the team's view_reports and
-- attendance permissions, and site admins (Kat, 2026-11-27). The public reads
-- pulls only through team_raid_pulls(), which returns the team's main
-- reports' pulls and nothing else.
--
-- The chart shows the pulls the progression card counts. #1938 made the same
-- pull in two reports count once, inside rebuild_team_raid_progress(); that
-- matching moves, unchanged, into team_main_pulls(team_id), which the rebuild
-- and team_raid_pulls() both read, so a pull two raiders logged is one dot on
-- the chart as it is one pull on the card.

drop policy "Public read team_raid_fights" on public.team_raid_fights;

create policy "Officers read team_raid_fights" on public.team_raid_fights for select
  using (((team_id = any ((select my_permission_team_ids('view_reports'))::integer[])) or (select is_site_admin())));
create policy "Attendance takers read team_raid_fights" on public.team_raid_fights for select
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[]));
create policy "Team raiders read team_raid_fights" on public.team_raid_fights for select
  using ((team_id in (select p.team_id from players p where p.id = any ((select my_active_player_ids())::integer[]))));

comment on table public.team_raid_fights is
  'Every Heroic and Mythic boss pull the progression sync reads for a team (#1470), alt runs included, one row per team, report and fight. Read by the team (its raiders, view_reports and attendance permissions) and site admins; the public reads the team''s own raids'' pulls through team_raid_pulls() (#1496). Written only by wcl-progression-sync.';

-- The team's main reports' pulls, each pull once (#1938): best copy first,
-- boss by boss. A fight is a copy when it overlaps a fight already kept from
-- another report for at least half of the shorter one; a copy goes to the
-- kept fight it overlaps longest, and a kept fight takes one copy from each
-- other report at most. Only a kept fight takes copies, so a fight that is
-- itself a copy never takes another pull with it.
create function public.team_main_pulls(p_team_id integer)
returns setof public.team_raid_fights
language plpgsql
stable
set search_path = public
as $$
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
$$;

alter function public.team_main_pulls(integer) owner to postgres;
revoke all on function public.team_main_pulls(integer) from public, anon, authenticated;
-- The progression sync's service role runs rebuild_team_raid_progress(), which
-- runs as its caller and reads this (CodeRabbit on PR #1946).
grant execute on function public.team_main_pulls(integer) to service_role;

comment on function public.team_main_pulls(integer) is
  'A team''s pulls from its main reports (team_raid_reports.effective_kind), each pull once: the same pull in two reports (overlapping for at least half of the shorter one) is the best copy, a kill before a wipe, then the lowest boss health, a report still on Warcraft Logs, the earliest report (#1938). Shared by rebuild_team_raid_progress() and team_raid_pulls() (#1496), so the card and the chart count the same pulls. Not callable from the site.';

create or replace function public.rebuild_team_raid_progress(p_team_id integer)
returns void
language plpgsql
set search_path = public
as $$
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
$$;

-- What the pull chart (#1474) shows, per pull of one boss (Kat, 2026-11-22,
-- on #1474), plus the difficulty and the raid night it is drawn and grouped
-- by. Runs as its owner so the public can call it, and returns main reports'
-- pulls only, each pull once.
create function public.team_raid_pulls(p_team_id integer, p_encounter_id integer)
returns table (
  report_code text,
  fight_id integer,
  difficulty text,
  raid_date date,
  started_at timestamp with time zone,
  boss_percentage numeric,
  kill boolean,
  last_phase integer,
  last_phase_is_intermission boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select f.report_code, f.fight_id, f.difficulty, r.raid_date, f.started_at, f.boss_percentage, f.kill,
         f.last_phase, f.last_phase_is_intermission
    from team_main_pulls(p_team_id) f
    join team_raid_reports r on r.team_id = f.team_id and r.report_code = f.report_code
   where f.encounter_id = p_encounter_id
   order by f.started_at, f.report_code, f.fight_id
$$;

alter function public.team_raid_pulls(integer, integer) owner to postgres;
revoke all on function public.team_raid_pulls(integer, integer) from public;
grant execute on function public.team_raid_pulls(integer, integer) to anon, authenticated;

comment on function public.team_raid_pulls(integer, integer) is
  'A team''s pulls of one boss from its own raids (main reports only, each pull once, as the progression card counts them; team_main_pulls()), for the public pull chart (#1474, #1496): report and fight, difficulty, raid night, start, boss health left, kill, and the last phase with whether it was an intermission. SECURITY DEFINER so anon reads what team_raid_fights no longer shows it; an alt run''s pulls never leave through it.';
