-- Function public.officer_set_rsvp: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.officer_set_rsvp(p_team_id integer, p_player_id integer, p_raid_date date, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
