-- #1845: attendance refreshes from Warcraft Logs on its own, every hour, and
-- commits scores to loot priority when nothing needs an officer's look.
--
-- 1. A raider on the roster who is not in the night's log and has no status
--    gets a row with status left blank and source 'WCL (Absent?)', the same
--    way a late arrival already gets 'WCL (Late?)'. Both clear the moment an
--    officer picks a status (the grid writes source 'Officer').
-- 2. attendance_log_names: someone in the log who is not on the roster (a
--    pug, a guest, an alt). Listed for an officer, never holds back the
--    commit (Kat, 2026-11-16).
-- 3. attendance_items_waiting(team): the Late? and Absent? rows this season
--    still without a status, on nights not excluded. Zero means the
--    scheduled run commits.
-- 4. commit_attendance_scores(team): the score math, moved out of the two
--    browsers (js/tabs/tab-attendance.js, app/src/attendance) so the button
--    and the schedule give the same numbers. Unchanged rules: every
--    non-excluded row with a weighted status, averaged per raider, written
--    for current_season(). SECURITY INVOKER, so the caller's own access to
--    scoring decides, as the direct upsert did.
--    An officer's commit writes its audit entry inside the function; the
--    hourly run (no signed-in user) writes none, its record is item 5.
-- 5. team_settings.attendance_sync_last_run: the last scheduled run per team,
--    the gear sync's shape (#1174), so a dead schedule shows.
-- 6. record_raid_night_participation() also admits the service role, which
--    is who the scheduled run is.
-- 7. The hourly job.
-- 8. A trigger keeps an officer's row: an update that would turn a source
--    'Officer' row into anything else leaves it as it was. The sync skips
--    officer rows it read at its start; this covers one an officer saves
--    while a run is in progress (CodeRabbit on PR #1858).

-- 1.
alter table public.attendance drop constraint attendance_source_check;
alter table public.attendance add constraint attendance_source_check
  check (source in ('WCL', 'Officer', 'Auto (Bench)', 'WCL (Late?)', 'WCL (Absent?)'));

-- 2.
create table public.attendance_log_names (
  team_id integer not null references public.teams(id) on delete cascade,
  raid_date date not null,
  character_name text not null,
  report_id text not null,
  seen_at timestamptz not null default now(),
  primary key (team_id, raid_date, character_name)
);

comment on table public.attendance_log_names is
  'Characters in a team''s Warcraft Logs raid night who matched nobody on the roster (#1845). Written by wcl-sync; first name only, lower case, as the sync matches names. Informational: never holds back the attendance commit.';

alter table public.attendance_log_names enable row level security;

create policy "Claude readers read attendance_log_names" on public.attendance_log_names
  for select to claude_readers using (true);
create policy "Officers read attendance_log_names" on public.attendance_log_names
  for select to authenticated
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));
-- The officer's Refresh from WCL writes with the officer's own session.
create policy "Officers add attendance_log_names" on public.attendance_log_names
  for insert to authenticated
  with check (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
              or team_id = any ((select my_guild_officer_team_ids())::integer[])
              or (select is_site_admin()));
create policy "Officers update attendance_log_names" on public.attendance_log_names
  for update to authenticated
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
              or team_id = any ((select my_guild_officer_team_ids())::integer[])
              or (select is_site_admin()));

revoke all on table public.attendance_log_names from public, anon, authenticated, service_role;
grant select, insert, update on table public.attendance_log_names to authenticated;
grant select, insert, update, delete on table public.attendance_log_names to service_role;
grant select on table public.attendance_log_names to claude_readers;

-- 3.
create or replace function public.attendance_items_waiting(p_team_id integer)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.attendance a
  where a.team_id = p_team_id
    and a.status is null
    and a.source in ('WCL (Late?)', 'WCL (Absent?)')
    and a.report_excluded = false
    and a.raid_date >= public.team_season_start(p_team_id)
$$;

comment on function public.attendance_items_waiting(integer) is
  'Attendance rows this season the sync flagged (Late?, Absent?) that still have no status, on nights not excluded (#1845). The scheduled run commits scores only at zero.';

revoke all on function public.attendance_items_waiting(integer) from public, anon;
grant execute on function public.attendance_items_waiting(integer) to authenticated, service_role;

-- 4.
create or replace function public.commit_attendance_scores(p_team_id integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_season text := public.current_season();
  v_committed integer;
  v_nights integer;
begin
  if v_season is null then
    raise exception 'No season has started';
  end if;

  with weighted as (
    select a.player_id, a.raid_date,
           case a.status
             when 'Present' then 1.0
             when 'Bench' then 1.0
             when 'Medical Leave' then 1.0
             when 'Extended Leave' then 1.0
             when 'Excused' then 0.8
             when 'Late (with notice)' then 0.9
             when 'Late (no notice)' then 0.5
             when 'No Show' then 0.0
           end as weight
    from public.attendance a
    where a.team_id = p_team_id
      and a.report_excluded = false
  ), ratios as (
    select player_id, avg(weight) as ratio
    from weighted
    where weight is not null
    group by player_id
  ), written as (
    insert into public.scoring (team_id, player_id, season, attendance_score, attendance_pct)
    select p_team_id, player_id, v_season, least(round(ratio * 10, 2), 10), round(ratio * 100, 1)
    from ratios
    on conflict (player_id, season) do update
      set attendance_score = excluded.attendance_score,
          attendance_pct = excluded.attendance_pct
    returning 1
  )
  select (select count(*) from written),
         (select count(distinct raid_date) from weighted where weight is not null)
    into v_committed, v_nights;

  if auth.uid() is not null and v_committed > 0 then
    perform public.write_audit_log(p_team_id, 'Attendance Scores Committed', null, null,
      to_jsonb(v_committed || ' players, ' || v_nights || ' nights'));
  end if;

  return jsonb_build_object('committed', v_committed, 'totalNights', v_nights);
end;
$$;

comment on function public.commit_attendance_scores(integer) is
  'Works out every raider''s attendance score and percentage from the team''s non-excluded rows and writes them to scoring for current_season() (#1845). The one copy of this math: the Attendance page button and the hourly wcl-sync run both call it. SECURITY INVOKER: the caller''s own scoring access applies.';

revoke all on function public.commit_attendance_scores(integer) from public, anon;
grant execute on function public.commit_attendance_scores(integer) to authenticated, service_role;

-- 5.
alter table public.team_settings add column if not exists attendance_sync_last_run jsonb;

comment on column public.team_settings.attendance_sync_last_run is
  'Outcome of the last scheduled wcl-sync attendance run for this team (#1845): started_at, finished_at, main_nights, excluded, waiting, committed, error (null when it worked).';

-- 6. Unchanged except the first check: the service role (the hourly run)
-- skips the signed-in and permission checks.
create or replace function public.record_raid_night_participation(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;

    if not (
      public.has_team_permission(p_team_id, 'attendance')
      or public.is_site_admin()
    ) then
      raise exception 'Not authorized';
    end if;
  end if;

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_participation (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$$;

revoke all on function public.record_raid_night_participation(integer, date, integer, integer[]) from public, anon;
grant execute on function public.record_raid_night_participation(integer, date, integer, integer[]) to authenticated, service_role;

-- 7. Minute 23 shares no minute with the other jobs (every 5, every 15,
-- 10:07). The local stack never fires it: seed.sql deactivates every
-- pg_cron job (#1055). Needs the Vault secret wcl_sync_secret and the
-- function secret WCL_SYNC_SECRET set to the same value.
do $$
begin
  perform cron.unschedule('wcl-sync-attendance');
exception when others then
  null;
end $$;

select cron.schedule(
  'wcl-sync-attendance',
  '23 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/wcl-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wcl_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

-- 8.
create or replace function public.keep_officer_attendance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source = 'Officer' and new.source is distinct from 'Officer' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_officer_attendance() from public, anon, authenticated;

create trigger trg_keep_officer_attendance
  before update on public.attendance
  for each row execute function public.keep_officer_attendance();
