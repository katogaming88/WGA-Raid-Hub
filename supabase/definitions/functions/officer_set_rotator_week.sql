-- Function public.officer_set_rotator_week: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.officer_set_rotator_week(p_team_id integer, p_player_id integer, p_week_start date, p_in boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_rotator boolean;
  v_date date;
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

  select is_rotator into v_is_rotator
  from players
  where id = p_player_id and team_id = p_team_id and archived_at is null;

  if v_is_rotator is null then
    raise exception 'Player not found on this team.';
  end if;
  if not v_is_rotator then
    raise exception 'Player is not a rotator.';
  end if;

  for v_date in
    select gs::date
    from generate_series(p_week_start, p_week_start + 6, interval '1 day') gs
    where (
      exists (
        select 1 from raid_schedule rs
        where rs.team_id = p_team_id
          and rs.active
          and rs.weekday = extract(dow from gs)::int
      )
      or exists (
        select 1 from raid_schedule_exceptions rse
        where rse.team_id = p_team_id
          and rse.raid_date = gs::date
          and rse.exception_type = 'added'
      )
    )
    and not exists (
      select 1 from raid_schedule_exceptions rse2
      where rse2.team_id = p_team_id
        and rse2.raid_date = gs::date
        and rse2.exception_type = 'cancelled'
    )
  loop
    if p_in then
      insert into raid_rsvps (team_id, player_id, raid_date, status, note)
      values (p_team_id, p_player_id, v_date, 'Rotator-In', 'Officer-assigned for the week of ' || p_week_start)
      on conflict (team_id, player_id, raid_date)
      do update set status = 'Rotator-In', note = excluded.note, updated_at = now();
    else
      delete from raid_rsvps
      where team_id = p_team_id and player_id = p_player_id and raid_date = v_date
        and status = 'Rotator-In';
    end if;
  end loop;

  perform public.write_audit_log(
    p_team_id,
    'Rotator Week Assignment',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('week_start', p_week_start, 'in', p_in)
  );
end;
$function$;
