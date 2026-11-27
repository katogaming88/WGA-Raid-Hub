-- #1470: every Heroic and Mythic boss pull the progression sync reads is kept,
-- and the progression card's numbers are rebuilt from them in SQL.
--
-- The sync reads every pull of every report on each run and kept three
-- numbers per boss and difficulty in team_raid_progress (pulls, best attempt,
-- first kill), throwing the wipes away. team_raid_fights keeps each pull: one
-- row per team, report and fight, with how far it got. Written only by
-- wcl-progression-sync's service role, rewritten on every run that reads the
-- report, never deleted; read by anyone, as team_raid_progress is, until
-- #1286 sets the rule at cutover.
--
-- rebuild_team_raid_progress() rebuilds a team's team_raid_progress rows from
-- the fights of its main reports (team_raid_reports.effective_kind, #1469), so
-- an alt run no longer sets a boss's kill date, its pull count or the AOTC
-- date. The sync calls it after writing the fights; #1472 will call it when
-- an officer changes a report. team_raid_kills stays a table (#1246 names its
-- rows from raid_schedule), filled by the sync as before.

create table public.team_raid_fights (
  team_id integer not null,
  report_code text not null,
  fight_id integer not null,
  encounter_id integer not null references public.raid_encounters(id) on delete cascade,
  difficulty text not null check (difficulty in ('heroic', 'mythic')),
  kill boolean not null,
  boss_percentage numeric(5,2),
  fight_percentage numeric(5,2),
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone not null,
  last_phase integer,
  last_phase_is_intermission boolean,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, report_code, fight_id),
  foreign key (team_id, report_code) references public.team_raid_reports(team_id, report_code) on delete cascade
);

create index team_raid_fights_team_encounter_idx on public.team_raid_fights (team_id, encounter_id, difficulty);

comment on table public.team_raid_fights is
  'Every Heroic and Mythic pull on a listed raid''s boss in a team''s Warcraft Logs reports (#1470), one row per fight, counted from the start of the tier the raid is filed under. Rewritten on every run that reads the report, never deleted. Written only by wcl-progression-sync; team_raid_progress is rebuilt from the main reports'' rows.';
comment on column public.team_raid_fights.kill is
  'Whether the pull killed the boss.';
comment on column public.team_raid_fights.boss_percentage is
  'The boss''s health left when the pull ended, in percent (Warcraft Logs'' bossPercentage); 0 on a kill.';
comment on column public.team_raid_fights.fight_percentage is
  'The fight''s own completion left, in percent (Warcraft Logs'' fightPercentage), which differs from boss_percentage on a fight with several bosses or a boss that heals.';
comment on column public.team_raid_fights.started_at is
  'When the pull started: the report''s start plus the fight''s offset.';
comment on column public.team_raid_fights.ended_at is
  'When the pull ended: the report''s start plus the fight''s end offset.';
comment on column public.team_raid_fights.last_phase is
  'The phase the pull ended in (Warcraft Logs'' lastPhase); null when it has none.';
comment on column public.team_raid_fights.last_phase_is_intermission is
  'Whether last_phase is an intermission.';

alter table public.team_raid_fights owner to postgres;
alter table public.team_raid_fights enable row level security;

create trigger trg_team_raid_fights_updated_at
  before update on public.team_raid_fights
  for each row execute function public.set_updated_at();

create policy "Claude readers read team_raid_fights" on public.team_raid_fights
  for select to claude_readers using (true);
create policy "Public read team_raid_fights" on public.team_raid_fights
  for select using (true);

-- Read only for the site's roles, and no delete for anyone. The sync inserts
-- and rewrites.
revoke all on table public.team_raid_fights from public, anon, authenticated, service_role;
grant select on table public.team_raid_fights to anon, authenticated;
grant select, insert, update on table public.team_raid_fights to service_role;

-- One row per boss the team has a fight on, whatever the report's kind: a
-- boss whose only pulls are alt runs keeps a row with no pulls and no kill.
-- The first kill is the earliest report's, then the lowest fight id, as the
-- sync's own count was; the best attempt is the lowest health left on a pull
-- that did not kill, the earliest on a tie. A row with no fights left (its
-- raid taken off the list) is not touched.
create function public.rebuild_team_raid_progress(p_team_id integer)
returns void
language sql
set search_path = public
as $$
  with main as (
    select f.encounter_id, f.difficulty, f.kill, f.boss_percentage, f.report_code, f.fight_id,
           r.raid_date, r.started_at as report_started_at
      from team_raid_fights f
      join team_raid_reports r on r.team_id = f.team_id and r.report_code = f.report_code
     where f.team_id = p_team_id
       and r.effective_kind = 'main'
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
  'Rebuilds a team''s team_raid_progress rows from team_raid_fights, counting only the fights of its main reports (#1470). Called by wcl-progression-sync after it writes the fights, and by an officer''s change to a report (#1472).';

alter function public.rebuild_team_raid_progress(integer) owner to postgres;
revoke all on function public.rebuild_team_raid_progress(integer) from public, anon, authenticated;
grant execute on function public.rebuild_team_raid_progress(integer) to service_role;

comment on table public.team_raid_progress is
  'Per team and boss, the first kill on each difficulty, the pull count and the best attempt so far (#285, #629), rebuilt by rebuild_team_raid_progress() from the fights of the team''s main reports in team_raid_fights (#1470). Every kill, by week, is in team_raid_kills.';
