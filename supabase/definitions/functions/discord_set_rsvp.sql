-- Function public.discord_set_rsvp: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.discord_set_rsvp(p_discord_id text, p_team_id integer, p_raid_date date, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  insert into raid_rsvps (team_id, player_id, raid_date, status, note)
  values (p_team_id, v_player_id, p_raid_date, p_status, p_note)
  on conflict (team_id, player_id, raid_date)
  do update set status = excluded.status, note = excluded.note, updated_at = now();

  perform queue_discord_post(p_team_id, 'rsvp_changes', 'rsvp', jsonb_build_object(
    'charName', v_name_realm, 'raidDate', p_raid_date::text, 'status', p_status, 'note', p_note));
end;
$function$;
