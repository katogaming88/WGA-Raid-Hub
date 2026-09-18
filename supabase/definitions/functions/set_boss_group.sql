-- Function public.set_boss_group: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boss_group(p_team_id integer, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer[];
  v_nights date[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this group since you opened it. Reload to see their change.';
  end if;

  delete from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;
  insert into boss_groups (team_id, encounter_id, player_id)
  select p_team_id, p_encounter_id, x from unnest(p_player_ids) x;

  select coalesce(array_agg(raid_date order by raid_date), '{}') into v_nights
  from raid_night_bosses
  where team_id = p_team_id and encounter_id = p_encounter_id
    and raid_date >= public.raid_today() and confirmed_at is null and not skipped;

  delete from raid_night_lineups
  where team_id = p_team_id and encounter_id = p_encounter_id and raid_date = any (v_nights);
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, d, p_encounter_id, x
  from unnest(v_nights) d, unnest(p_player_ids) x
  join players p on p.id = x and not p.is_bench;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Group',
    'boss_groups',
    p_encounter_id,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'nights_following', to_jsonb(v_nights)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;
