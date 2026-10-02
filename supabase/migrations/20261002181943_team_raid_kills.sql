-- #1246: every boss kill the progression sync reads is kept, one row per fight,
-- and the bosses killed since this week's reset are one query away.
--
-- team_raid_progress keeps a boss's first kill only, so a boss on farm looks
-- the same every week and nothing can tell a boss killed on Tuesday from one
-- killed in August. The sync already reads every kill of every report on each
-- run; team_raid_kills keeps them, dated by the report's raid night (the same
-- date attendance uses). Written only by wcl-progression-sync's service role;
-- read by the team's raiders and officers, as raid_night_participation is.
--
-- lockout_week_start() is the Tuesday on or before a raid date: the US weekly
-- reset. A raid date already puts a Monday night's 1 a.m. kill on Monday, so
-- dates are enough. team_raid_kills_this_week lists each boss down since the
-- reset, once per difficulty, from its first kill. It runs as the caller, so
-- raid_today() is granted for it; it returns only the date.

create table public.team_raid_kills (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  encounter_id integer not null references public.raid_encounters(id) on delete cascade,
  difficulty text not null check (difficulty in ('heroic', 'mythic')),
  report_code text not null,
  fight_id integer not null,
  raid_date date not null,
  created_at timestamp with time zone not null default now(),
  unique (team_id, report_code, fight_id)
);

create index team_raid_kills_team_encounter_date_idx on public.team_raid_kills (team_id, encounter_id, raid_date);

comment on table public.team_raid_kills is
  'Every Heroic and Mythic boss kill in a team''s Warcraft Logs reports (#1246), one row per fight, dated by the report''s raid night. Written only by wcl-progression-sync. team_raid_progress holds the first kill per boss; this holds them all.';

alter table public.team_raid_kills owner to postgres;
alter table public.team_raid_kills enable row level security;

create policy "Claude readers read team_raid_kills" on public.team_raid_kills
  for select to claude_readers using (true);
create policy "Officers read team_raid_kills" on public.team_raid_kills for select
  using (((team_id = any ((select my_officer_team_ids())::integer[])) or (select is_guild_officer()) or (select is_site_admin())));
create policy "Team raiders read team_raid_kills" on public.team_raid_kills for select
  using ((team_id in (select p.team_id from players p where p.id = any ((select my_active_player_ids())::integer[]))));

comment on table public.team_raid_progress is
  'Per team and boss, the first kill on each difficulty, the pull count and the best attempt so far (#285, #629), rebuilt from every report on each wcl-progression-sync run. Every kill, by week, is in team_raid_kills.';

create function public.lockout_week_start(p_raid_date date)
returns date
language sql
immutable
set search_path = public
as $$ select p_raid_date - ((extract(isodow from p_raid_date)::integer + 5) % 7); $$;

comment on function public.lockout_week_start(date) is
  'The Tuesday on or before a raid date: the start of its Warcraft weekly lockout. Not the rotator''s week, which runs Sunday to Saturday (officer_set_rotator_week).';

alter function public.lockout_week_start(date) owner to postgres;
grant execute on function public.raid_today() to anon, authenticated;

create view public.team_raid_kills_this_week
with (security_invoker = on) as
select distinct on (k.team_id, k.encounter_id, k.difficulty)
  k.team_id,
  k.encounter_id,
  e.name as encounter_name,
  k.difficulty,
  k.raid_date,
  k.report_code,
  k.fight_id
from public.team_raid_kills k
join public.raid_encounters e on e.id = k.encounter_id
where public.lockout_week_start(k.raid_date) = public.lockout_week_start(public.raid_today())
order by k.team_id, k.encounter_id, k.difficulty, k.raid_date, k.id;

comment on view public.team_raid_kills_this_week is
  'Each boss a team has killed since this week''s Tuesday reset, once per difficulty, with its first kill of the week (#1246).';

alter view public.team_raid_kills_this_week owner to postgres;
