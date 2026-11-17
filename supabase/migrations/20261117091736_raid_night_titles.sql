-- #1478: a raid night can carry its own title, shown on the Calendar.
--
-- Two places, first match wins (Kat, 2026-10-06): a title for one date, then
-- the weekly night's title, then a heading worked out where it is shown (the
-- night's difficulty). Nothing default is stored, so changing the team
-- default difficulty still changes every untitled night by itself.
--
-- The weekly title is a column on raid_schedule. A one-date title has no row
-- to live on: a normal Tuesday is computed from the weekly rule, not stored.
-- It gets its own table, raid_night_titles, one row per team and date,
-- rather than a third raid_schedule_exceptions type, since the current site's
-- Schedule tab lists every exception that is not 'added' as a cancelled night.
-- A date's title covers every night on that date, an extra night included.
--
-- raid_night_titles reads and writes as raid_schedule does: anyone reads;
-- whoever holds the team's edit_schedule permission, and site admins, write.

alter table public.raid_schedule
  add column title text check (char_length(title) between 1 and 40 and title = btrim(title));

comment on column public.raid_schedule.title is
  'This weekly night''s own title (#1478), such as "Mythic Prog"; null is headed by the night''s difficulty where it is shown. A date in raid_night_titles takes its place for that date only.';

create table public.raid_night_titles (
  team_id integer not null references public.teams (id) on delete cascade,
  raid_date date not null,
  title text not null check (char_length(title) between 1 and 40 and title = btrim(title)),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, raid_date)
);

comment on table public.raid_night_titles is
  'A title for one raid date (#1478): "Rename this night" on the night''s page. It covers every night on that date and wins over raid_schedule.title; the next week goes back to the weekly title. Written by the officers who write raid_schedule.';

alter table public.raid_night_titles owner to postgres;
alter table public.raid_night_titles enable row level security;

create trigger trg_raid_night_titles_updated_at
  before update on public.raid_night_titles
  for each row execute function public.set_updated_at();

create policy "Claude readers read raid_night_titles" on public.raid_night_titles
  for select to claude_readers using (true);
create policy "Public read raid_night_titles" on public.raid_night_titles
  for select using (true);
create policy "Officers write raid_night_titles" on public.raid_night_titles
  using (((team_id = ANY ((SELECT my_permission_team_ids('edit_schedule'::text))::integer[])) OR (SELECT is_site_admin())))
  with check (((team_id = ANY ((SELECT my_permission_team_ids('edit_schedule'::text))::integer[])) OR (SELECT is_site_admin())));

revoke all on table public.raid_night_titles from public, anon, authenticated, service_role;
grant select on table public.raid_night_titles to anon;
grant select, insert, update, delete on table public.raid_night_titles to authenticated, service_role;
grant select on table public.raid_night_titles to claude_readers;
