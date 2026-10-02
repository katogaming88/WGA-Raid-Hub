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
-- dates are enough. lockout_start_at() is the lockout an instant falls in, and
-- it turns over at the reset itself (Tuesday 15:00 UTC), not at midnight.
-- team_raid_kills_this_week lists each boss down since the reset, once per
-- difficulty, from the earliest report's kill.

create table public.team_raid_kills (
  id integer generated always as identity primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  encounter_id integer not null references public.raid_encounters(id) on delete cascade,
  difficulty text not null check (difficulty in ('heroic', 'mythic')),
  report_code text not null,
  fight_id integer not null,
  raid_date date not null,
  report_started_at timestamp with time zone not null,
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

create function public.lockout_start_at(p_at timestamp with time zone)
returns date
language sql
stable
set search_path = public
as $$ select public.lockout_week_start(((p_at at time zone 'UTC') - interval '15 hours')::date); $$;

comment on function public.lockout_start_at(timestamp with time zone) is
  'The Tuesday that starts the weekly lockout an instant falls in. The US reset is Tuesday 15:00 UTC, so Tuesday before then is still the week before.';

alter function public.lockout_start_at(timestamp with time zone) owner to postgres;

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
where k.raid_date >= public.lockout_start_at(now())
  and k.raid_date < public.lockout_start_at(now()) + 7
order by k.team_id, k.encounter_id, k.difficulty, k.report_started_at, k.fight_id;

comment on view public.team_raid_kills_this_week is
  'Each boss a team has killed since this week''s Tuesday reset, once per difficulty, with its first kill of the week (#1246).';

alter view public.team_raid_kills_this_week owner to postgres;
