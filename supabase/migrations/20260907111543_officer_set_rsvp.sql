-- #903 (part of #640): officers need a correction path for a raider's RSVP
-- (e.g. fixing a status the raider forgot to update themselves). The
-- 2026-09-03 "raid_rsvps has no public or officer write policy at all"
-- decision (docs/database-decisions.md) deliberately left every write to
-- set_own_rsvp() -- an RSVP is a first-person statement, not something an
-- officer should silently rewrite via a blanket write grant -- but named
-- exactly this as the shape a future correction path should take: "its own
-- explicitly-named function/action later." This is that function.
--
-- Unlike set_own_rsvp(), the target player is a parameter (an officer is
-- acting on someone else's behalf, not resolving their own row from
-- auth.uid()), there's no bench-on-a-normal-night gate (a correction should
-- be able to fix any player's row regardless of bench state -- that's the
-- point), and a note is always required, even for a correction the officer
-- initiates, so the raider can see why their answer changed.
create or replace function public.officer_set_rsvp(
  p_team_id integer,
  p_player_id integer,
  p_raid_date date,
  p_status text,
  p_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_status is not null and p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not public.is_optional_raid_night(p_team_id, p_raid_date) then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  if p_status is not null and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required so the raider knows why this was changed.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = p_player_id and raid_date = p_raid_date;
  else
    insert into raid_rsvps (team_id, player_id, raid_date, status, note)
    values (p_team_id, p_player_id, p_raid_date, p_status, p_note)
    on conflict (team_id, player_id, raid_date)
    do update set status = excluded.status, note = excluded.note, updated_at = now();
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Officer Set RSVP',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('raid_date', p_raid_date, 'status', p_status, 'note', p_note)
  );
end;
$$;

alter function public.officer_set_rsvp(integer, integer, date, text, text) owner to postgres;

revoke all on function public.officer_set_rsvp(integer, integer, date, text, text) from public;
revoke execute on function public.officer_set_rsvp(integer, integer, date, text, text) from anon;
grant execute on function public.officer_set_rsvp(integer, integer, date, text, text) to authenticated;
