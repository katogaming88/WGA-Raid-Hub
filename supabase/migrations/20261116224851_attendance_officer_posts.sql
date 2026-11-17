-- #1847: the bot posts each raid night's attendance problems to the team's
-- officer channel once, and later hourly runs edit that post as officers
-- set statuses, down to "all set". team_attendance_posts remembers the
-- message for each team and night, so a run edits it instead of posting
-- again. Service role only, like team_lineup_posts.

create table public.team_attendance_posts (
  team_id integer not null references public.teams (id) on delete cascade,
  raid_date date not null,
  channel_id text not null,
  message_id text not null,
  -- What the posted message lists, so a run tells an unchanged night apart
  -- without reading Discord. 'all set' once nothing is left.
  content_key text not null,
  posted_at timestamp with time zone not null default now(),
  primary key (team_id, raid_date)
);

comment on table public.team_attendance_posts is
  'The officer-channel message wcl-sync''s hourly run posted for each team and raid night with attendance items (#1847). content_key is what the message lists (''all set'' once every item has a status). Written by wcl-sync with the service role; later runs edit this message as items are set.';

alter table public.team_attendance_posts owner to postgres;
alter table public.team_attendance_posts enable row level security;

create policy "Claude readers read team_attendance_posts" on public.team_attendance_posts
  for select to claude_readers using (true);

revoke all on table public.team_attendance_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_attendance_posts to service_role;
grant select on table public.team_attendance_posts to claude_readers;
