-- #1846: a raider's Calendar RSVP fills in their attendance on its own.
--
-- The hourly refresh (wcl-sync, #1845) reads each raider's RSVP for the
-- night, and only one last changed before the raid started counts as notice
-- (Kat, 2026-11-16): an RSVP changed after the start reads as no RSVP.
--
--   RSVP Absent,    not in the log            -> Excused
--   RSVP Late,      missed their first boss   -> Late (with notice)
--   RSVP Tentative, not in the log            -> the team's choice below,
--                                                or Needs a look (Absent?)
--   in the log on time                        -> Present, whatever the RSVP
--   no RSVP,        not in the log            -> Needs a look (Absent?)
--
-- 1. A new attendance source, 'Calendar (RSVP)', for a row the RSVP filled
--    in, so the grid says where the status came from. An officer's pick
--    still replaces it (source 'Officer'), and keep_officer_attendance()
--    still keeps an officer's row from the sync.
-- 2. attendance_rsvps_before_start(team, nights): the team's RSVPs for the
--    nights asked about, last changed before each night's start, at the team's time zone. The start comes
--    from raid_night_info(), the Calendar's own answer for a night; a night
--    it does not know (cancelled, or off the schedule) has no RSVPs that
--    count: a team with no weekly schedule gets no fill until it sets one
--    (Kat, 2026-11-16, after the fresh review).
--    SECURITY DEFINER with its own gate: the hourly run (service role),
--    whoever has the team's attendance permission (the Refresh button), or
--    a site admin. Reading as the caller would have tied the fill to the
--    rank's RSVP permission, so a rank with attendance but not RSVPs would
--    refresh nights unfilled for good (fresh review). It answers only who,
--    which night and which RSVP, never the raider's note.
--    It takes the nights so a caller reads a few nights' RSVPs, never a
--    season's worth past PostgREST's 1000-row cap.
-- 3. set_team_attendance_tentative(team, status): the team's choice for
--    "said Tentative, then wasn't in the log", saved on team_settings.config
--    as "attendanceTentative". Any status that counts toward the score
--    except the two leave ones (Kat, 2026-11-16; leave is #1860), or null
--    for Needs a look, the default. Saved the way set_team_audit_rules()
--    saves its rules: promote_assistants on the team (Officer by default,
--    which opens Settings), or a site admin.

-- 1.
alter table public.attendance drop constraint attendance_source_check;
alter table public.attendance add constraint attendance_source_check
  check (source in ('WCL', 'Officer', 'Auto (Bench)', 'WCL (Late?)', 'WCL (Absent?)', 'Calendar (RSVP)'));

-- 2.
create or replace function public.attendance_rsvps_before_start(p_team_id integer, p_dates date[])
returns table (player_id integer, raid_date date, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;
    if not (public.has_team_permission(p_team_id, 'attendance') or public.is_site_admin()) then
      raise exception 'Not authorized';
    end if;
  end if;

  return query
  select r.player_id, r.raid_date, r.status
  from public.raid_rsvps r
  cross join lateral public.raid_night_info(r.team_id, r.raid_date) n
  where r.team_id = p_team_id
    and r.raid_date = any (p_dates)
    and n."exists"
    and r.updated_at < ((r.raid_date + n.start_time) at time zone n.timezone);
end;
$$;

comment on function public.attendance_rsvps_before_start(integer, date[]) is
  'A team''s Calendar RSVPs for the given nights, last changed before their raid night started, in the team''s time zone (#1846). The hourly attendance refresh fills statuses from these; one changed after the start does not count as notice.';

revoke all on function public.attendance_rsvps_before_start(integer, date[]) from public, anon;
grant execute on function public.attendance_rsvps_before_start(integer, date[]) to authenticated, service_role;

-- 3.
create or replace function public.set_team_attendance_tentative(p_team_id integer, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  if not (
    public.has_team_permission(p_team_id, 'promote_assistants')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_status is not null and p_status not in
    ('Present', 'Bench', 'Late (with notice)', 'Excused', 'Late (no notice)', 'No Show') then
    raise exception '% is not a status a Tentative RSVP can become.', p_status;
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('attendanceTentative', p_status)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Attendance Tentative Saved',
    'team_settings',
    null,
    to_jsonb(coalesce(p_status, 'Needs a look'))
  );

  return v_config;
end;
$$;

comment on function public.set_team_attendance_tentative(integer, text) is
  'Saves what a Calendar RSVP of Tentative becomes when the raider is not in the log (#1846): an attendance status, or null for Needs a look. team_settings.config.attendanceTentative.';

revoke all on function public.set_team_attendance_tentative(integer, text) from public, anon;
grant execute on function public.set_team_attendance_tentative(integer, text) to authenticated;
