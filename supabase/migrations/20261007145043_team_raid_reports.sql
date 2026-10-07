-- #1469: a row for every Warcraft Logs report the progression sync reads,
-- saying whether it is the team's raid.
--
-- Three readers decide on their own today. Attendance (wcl-sync) leaves out
-- a report with "Alt" as a word in its title and keeps no record of it;
-- team_raid_kills and team_raid_progress count every report in the team's
-- guild, alt runs included. Nothing lists the reports themselves, so an
-- officer can neither see what was read nor overturn the title rule.
--
-- team_raid_reports is that list: one row per team and report, rewritten by
-- the sync on every run, with the title rule's verdict in kind. An officer's
-- choice goes in kind_override (#1472), and effective_kind is the one the
-- readers will count (#1471). A row is never deleted: the sync reads a
-- guild's reports from the tier start, so this copy is the record of anything
-- older.
-- Written only by wcl-progression-sync's service role; read by the team's
-- raiders and officers, as team_raid_kills is, until #1286 sets the rule for
-- a new table.

create table public.team_raid_reports (
  team_id integer not null references public.teams(id) on delete cascade,
  report_code text not null,
  title text,
  started_at timestamp with time zone not null,
  raid_date date not null,
  wcl_zone_id integer,
  boss_pulls integer not null default 0,
  boss_kills integer not null default 0,
  kind text not null check (kind in ('main', 'alt')),
  kind_override text check (kind_override in ('main', 'alt')),
  kind_override_by integer references public.people(id) on delete set null,
  kind_override_at timestamp with time zone,
  effective_kind text generated always as (coalesce(kind_override, kind)) stored,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, report_code),
  constraint team_raid_reports_override_has_time check ((kind_override is null) = (kind_override_at is null))
);

create index team_raid_reports_team_date_idx on public.team_raid_reports (team_id, raid_date desc);

comment on table public.team_raid_reports is
  'Every Warcraft Logs report the progression sync reads for a team (#1469), one row per team and report, rewritten on every run and never deleted. kind is the title rule''s verdict, kind_override an officer''s choice, effective_kind the one that counts. Written only by wcl-progression-sync.';
comment on column public.team_raid_reports.title is
  'The title as Warcraft Logs returns it; null when it has none. A report uploaded with no title gets a default one there, such as the raid''s name.';
comment on column public.team_raid_reports.raid_date is
  'The report''s raid night: its start in Eastern time, a start before 6 a.m. counting as the night before, as on team_raid_kills and attendance.';
comment on column public.team_raid_reports.wcl_zone_id is
  'The zone Warcraft Logs tags the report with, null when it has none. Not a key to raid_zones: a report can be of a raid no team lists.';
comment on column public.team_raid_reports.boss_pulls is
  'Heroic and Mythic fights in the report on the bosses of the raids the team lists for the current tier, as the progression card counts them.';
comment on column public.team_raid_reports.boss_kills is
  'The kills among boss_pulls.';
comment on column public.team_raid_reports.kind is
  'The title rule''s verdict: alt when the title has "Alt" as its own word, main otherwise. Rewritten on every run that reads the report (those since the tier start), so a report renamed on Warcraft Logs moves on the next one.';
comment on column public.team_raid_reports.kind_override is
  'An officer''s choice of main or alt (#1472), which the sync never writes; null leaves the verdict standing.';
comment on column public.team_raid_reports.kind_override_by is
  'The person who set kind_override.';
comment on column public.team_raid_reports.kind_override_at is
  'When kind_override was set; set exactly when it is.';
comment on column public.team_raid_reports.effective_kind is
  'kind_override when set, else kind: whether the report counts as the team''s raid.';

-- The sync now reads the reports since the tier start, not every report.
comment on table public.team_raid_progress is
  'Per team and boss, the first kill on each difficulty, the pull count and the best attempt so far (#285, #629), rebuilt on each wcl-progression-sync run from the reports since the tier start (#1469). A raid filed under an earlier tier keeps what that tier left it. Every kill, by week, is in team_raid_kills.';

alter table public.team_raid_reports owner to postgres;
alter table public.team_raid_reports enable row level security;

create trigger trg_team_raid_reports_updated_at
  before update on public.team_raid_reports
  for each row execute function public.set_updated_at();

create policy "Claude readers read team_raid_reports" on public.team_raid_reports
  for select to claude_readers using (true);
create policy "Officers read team_raid_reports" on public.team_raid_reports for select
  using (((team_id = any ((select my_officer_team_ids())::integer[])) or (select is_guild_officer()) or (select is_site_admin())));
create policy "Team raiders read team_raid_reports" on public.team_raid_reports for select
  using ((team_id in (select p.team_id from players p where p.id = any ((select my_active_player_ids())::integer[]))));

-- Read only for the site's roles, and no delete for anyone: every other
-- privilege is revoked, so a direct write fails loudly rather than being
-- filtered to nothing. The sync inserts and rewrites.
revoke all on table public.team_raid_reports from public, anon, authenticated, service_role;
grant select on table public.team_raid_reports to anon, authenticated;
grant select, insert, update on table public.team_raid_reports to service_role;
