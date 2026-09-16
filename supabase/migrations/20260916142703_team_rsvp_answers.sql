-- #1102: team_rsvp_answers() -- a team's raid-night answers without their
-- notes, for the new app's Calendar page.
--
-- Kat decided (2026-09-16) that raiders see every teammate's answer for a
-- night (Absent, Late, ...) and the real counts, but not the notes, which are
-- written for officers ("Out of town"). raid_rsvps only lets a raider read
-- their own rows, so today a raider's calendar shows everyone as Present even
-- when a teammate has said they are out.
--
-- A function rather than a wider read on raid_rsvps: a table-level grant
-- cannot hide one column from raiders while officers keep it, and the note is
-- the part that must stay with officers. Officers keep reading raid_rsvps
-- directly, notes included.
--
-- Who may call it: anyone with an active character on that team, that team's
-- officers and leader, guild officers and site admins. Anyone else, and a
-- signed-out caller, gets an error rather than an empty list, so a page can
-- tell "no answers yet" from "not allowed". The range is capped at 62 days:
-- the page reads one month at a time.

create or replace function "public"."team_rsvp_answers"(
    "p_team_id" integer,
    "p_from" date,
    "p_to" date
) returns table (
    "player_id" integer,
    "raid_date" date,
    "status" text,
    "updated_at" timestamp with time zone
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    exists (
      select 1 from players p
      where p.team_id = p_team_id
        and p.id = any (public.my_active_player_ids())
    )
    or coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.';
  end if;

  return query
    select r.player_id, r.raid_date, r.status, r.updated_at
    from raid_rsvps r
    where r.team_id = p_team_id
      and r.raid_date between p_from and p_to
    order by r.raid_date, r.player_id;
end;
$$;

alter function "public"."team_rsvp_answers"(integer, date, date) owner to "postgres";

comment on function "public"."team_rsvp_answers"(integer, date, date) is
  'A team''s raid-night answers (player, night, status, when) without the notes, for raiders on that team, its officers, guild officers and site admins (#1102). Officers read notes from raid_rsvps directly.';

revoke all on function "public"."team_rsvp_answers"(integer, date, date) from public, anon;
grant execute on function "public"."team_rsvp_answers"(integer, date, date) to authenticated;
