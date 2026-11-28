-- #1471: the killed-boss skip, a newly planned night and this week's kills
-- count only the team's own raids.
--
-- team_raid_kills keeps every kill the progression sync reads, alt runs
-- included, and until now every reader counted them all, so an alt group's
-- kill took its boss off the team's later nights. team_raid_reports (#1469)
-- says which reports are the team's: effective_kind, the officer's override
-- else the title rule's verdict. The readers now count main reports only.
--
-- kills_before_night() is the one rule the skip and fill_raid_night() share,
-- so changing it moves both, and the skip's "every kill before the night
-- arrived in this insert" check, which reads it, now looks at main kills
-- only: a stored alt-run kill no longer stops the team's first real kill from
-- taking its boss off a night, and an alt-run kill in the insert takes nothing
-- off.
--
-- A kill now needs its report's row, as a fight does (#1470). The sync writes
-- the reports first, but a failed report write left the kills saving anyway:
-- such a kill would count for nothing in the trigger, and the next run, which
-- sends it again as a duplicate, would not fire it either, so a night already
-- planned would keep the boss all lockout (fresh-agent review on PR #1943).
-- With the key the kill's insert fails instead, and the next run brings it as
-- new. Every kill on production has its report row (2026-11-27).
alter table public.team_raid_kills
  add constraint team_raid_kills_report_fkey
  foreign key (team_id, report_code) references public.team_raid_reports(team_id, report_code) on delete cascade;
--
-- A report deleted from Warcraft Logs (missing_since set) still counts, as on
-- the progression card (#1938): the kill happened. A report whose kind an
-- officer changes after the fact is #1472's.
--
-- Attendance from logs (wcl-sync) now reads effective_kind too, on the
-- caller's own sign-in, and falls back to the title rule for a report it gets
-- no row for. A caller with the attendance permission but not view_reports,
-- and not on the team, would see no rows and file an alt run an officer
-- marked as the team's raid (CodeRabbit on PR #1943). So whoever can take a
-- team's attendance reads its reports.
create policy "Attendance takers read team_raid_reports" on public.team_raid_reports for select
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[]));

create or replace function public.kills_before_night(p_team_id integer, p_encounter_id integer, p_raid_date date, p_difficulty text)
returns setof public.team_raid_kills
language sql
stable
set search_path = public
as $$
  select k.*
  from team_raid_kills k
  join team_raid_reports r on r.team_id = k.team_id and r.report_code = k.report_code
  where k.team_id = p_team_id
    and k.encounter_id = p_encounter_id
    and k.difficulty = p_difficulty
    and k.raid_date >= lockout_week_start(p_raid_date)
    and k.raid_date < p_raid_date
    and lockout_start_at(k.report_started_at) = lockout_week_start(p_raid_date)
    and r.effective_kind = 'main'
$$;

comment on function public.kills_before_night(integer, integer, date, text) is
  'A team''s kills of a boss at one difficulty earlier in a raid night''s lockout, before the night itself (#1246), from the team''s main reports only (team_raid_reports.effective_kind, #1471). A kill counts in the lockout its report started in, so a Tuesday report from before the reset belongs to the week before. The rule the killed-boss skip and fill_raid_night() share.';

create or replace view public.team_raid_kills_this_week with (security_invoker = on) as
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
join public.team_raid_reports r on r.team_id = k.team_id and r.report_code = k.report_code
where k.raid_date >= public.lockout_start_at(now())
  and k.raid_date < public.lockout_start_at(now()) + 7
  and r.effective_kind = 'main'
order by k.team_id, k.encounter_id, k.difficulty, k.report_started_at, k.fight_id;

comment on view public.team_raid_kills_this_week is
  'Each boss a team has killed in its main reports (team_raid_reports.effective_kind, #1471) since this week''s Tuesday reset, once per difficulty, with its first kill of the week (#1246).';

comment on table public.team_raid_kills is
  'Every Heroic and Mythic boss kill in a team''s Warcraft Logs reports (#1246), alt runs included, one row per fight, dated by the report''s raid night. Written only by wcl-progression-sync. Its readers count main reports only (team_raid_reports.effective_kind, #1471). Each insert takes the bosses the team''s main reports killed off the team''s later nights that lockout (skip_killed_bosses()).';
