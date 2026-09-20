-- #933: raid_zones.season holds the season code, and the current tier has a
-- definition. Closes #923.
--
-- raid_zones was the last table the Season View dropdown read, and it held
-- the tier's display name ("Midnight Season 2"), so the value an officer
-- picked was a name while every table it went on to query (priority_order,
-- scoring, the three priority marker tables, generate_priority_order()'s
-- p_season) holds the code ("MID2"). A name there matches nothing, and the
-- LEFT JOIN on scoring turned that into every player scoring null rather
-- than an error (#923). The three rows convert to codes and the foreign key
-- moves from seasons(display_name) to seasons(code). A Season View a team
-- has stored as a name converts with them, so the key holds a code by
-- construction (no team has one set, on either stack).
--
-- current_season(p_on) is the latest tier whose start has passed on that
-- day, by start date alone: since #1189 (2026-09-20) the season is app-wide
-- with one set of dates, no team rolls over early, and a date that slips is
-- fixed by a migration, so a tier stays current until the next one's
-- migration lands. The date argument is what makes it testable; the default
-- is today in Eastern, the guild's clock. It reads seasons under the
-- caller's own rights (public read), so anon may call it. Its first reader is
-- wcl-progression-sync, which stamps a raid it has not filed before with it,
-- for every team; a raid already on file keeps the tier it was filed under,
-- so the outgoing raid still on a team's list on launch day is not re-filed
-- under the new tier. #932 kept the syncing team's seasonName as the stamp
-- because a team could roll over early, and that reason is gone with #1189's
-- decision.
--
-- fill_raid_night() joined seasons on the display name to find the season a
-- night falls in; it joins on the code now. Body otherwise unchanged from
-- 20260918005412, grants preserved by create or replace.

alter table public.raid_zones drop constraint raid_zones_season_fkey;

update public.raid_zones z
set season = s.code
from public.seasons s
where s.display_name = z.season;

alter table public.raid_zones
  add constraint raid_zones_season_fkey foreign key (season) references public.seasons (code);

update public.team_settings t
set config = jsonb_set(t.config, '{seasonView}', to_jsonb(s.code))
from public.seasons s
where t.config->>'seasonView' = s.display_name;

create or replace function public.current_season(
  p_on date default (now() at time zone 'America/New_York')::date
)
returns text
language sql
stable
set search_path = public
as $$
  select code
  from public.seasons
  where starts_at <= p_on
  order by starts_at desc
  limit 1
$$;

revoke all on function public.current_season(date) from public;
grant execute on function public.current_season(date) to anon, authenticated, service_role;

create or replace function public.fill_raid_night(p_team_id integer, p_raid_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if exists (select 1 from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date) then
    return 0;
  end if;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position)
  select p_team_id, p_raid_date, e.id, row_number() over (order by z.sort_index, z.id, e.sort_index, e.id)
  from raid_encounters e
  join raid_zones z on z.id = e.zone_id
  join seasons s on s.code = z.season
  where p_raid_date between s.starts_at and coalesce(s.ends_at, 'infinity'::date)
    and exists (select 1 from boss_groups g where g.team_id = p_team_id and g.encounter_id = e.id);

  get diagnostics v_count = row_count;

  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, b.encounter_id, g.player_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date;

  return v_count;
end;
$$;
