-- #983: a raider sets their own RSVP for a raid night from the Discord
-- signup sheet's "Set your status" dropdown.
--
-- discord_set_rsvp() is set_own_rsvp() for a Discord account instead of the
-- signed-in user: the same checks, the same raid_rsvps write and the same
-- rsvp_changes notice. It finds the raider through people.discord_id, as
-- discord-interactions' permission check does, because nobody signs in to a
-- Discord button press.
--
-- It takes the Discord id as an argument, so it is the service role's only:
-- a signed-in raider holding it could change anyone's answer. It is SECURITY
-- INVOKER, so it runs with the service role's own rights; the request's
-- signature check in discord-interactions is what stands in front of that.
--
-- queue_discord_post() was revoked from every role, the service role too, so
-- only the writes that post could call it. This function is one of those
-- writes and runs as the service role, so the service role gets it. That
-- adds nothing the service role could not already do: it may insert into
-- discord_post_queue directly.
--
-- One check set_own_rsvp() leaves to the page: every answer but Attending
-- needs a note.

create or replace function public.discord_set_rsvp(
  p_discord_id text,
  p_team_id integer,
  p_raid_date date,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_person_id integer;
  v_player_id integer;
  v_is_bench boolean;
  v_is_optional boolean;
  v_name_realm text;
begin
  if p_discord_id is null then
    raise exception 'No Discord account given.';
  end if;

  select id into v_person_id from people where discord_id = p_discord_id;
  if v_person_id is null then
    raise exception 'No Raid Hub profile has this Discord account.';
  end if;

  select p.id, p.is_bench, p.name_realm into v_player_id, v_is_bench, v_name_realm
  from players p
  join team_members tm on tm.id = p.team_member_id
  where tm.person_id = v_person_id
    and tm.archived_at is null
    and p.team_id = p_team_id
    and p.archived_at is null;

  if v_player_id is null then
    raise exception 'No active roster character found for this team.';
  end if;

  v_is_optional := is_optional_raid_night(p_team_id, p_raid_date);

  if v_is_bench and not v_is_optional then
    raise exception 'Bench players cannot set an RSVP status.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = v_player_id and raid_date = p_raid_date;
    return;
  end if;

  if p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not v_is_optional then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  -- The site asks for a note on every answer but Attending; here the pop-up
  -- does, and a note of only spaces is no note (CodeRabbit on #1758).
  if p_status <> 'Attending' and nullif(btrim(p_note), '') is null then
    raise exception 'A note is required so officers know why.';
  end if;

  insert into raid_rsvps (team_id, player_id, raid_date, status, note)
  values (p_team_id, v_player_id, p_raid_date, p_status, p_note)
  on conflict (team_id, player_id, raid_date)
  do update set status = excluded.status, note = excluded.note, updated_at = now();

  perform queue_discord_post(p_team_id, 'rsvp_changes', 'rsvp', jsonb_build_object(
    'charName', v_name_realm, 'raidDate', p_raid_date::text, 'status', p_status, 'note', p_note));
end;
$$;

comment on function public.discord_set_rsvp(text, integer, date, text, text) is
  'A raider''s own RSVP for one raid night, set from the Discord signup sheet (#983): set_own_rsvp() for the Discord account that pressed it. Service role only, since it takes the Discord id as an argument.';

revoke all on function public.discord_set_rsvp(text, integer, date, text, text) from public, anon, authenticated;
grant execute on function public.discord_set_rsvp(text, integer, date, text, text) to service_role;

grant execute on function public.queue_discord_post(integer, text, text, jsonb) to service_role;
grant execute on function public.is_optional_raid_night(integer, date) to service_role;
