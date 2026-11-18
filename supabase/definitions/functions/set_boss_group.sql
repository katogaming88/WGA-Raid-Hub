-- Function public.set_boss_group: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boss_group(p_team_id integer, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[], p_picks jsonb DEFAULT NULL::jsonb, p_expected_picks jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer[];
  v_current_picks jsonb;
  v_nights date[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  -- The picked alts stay put until this save is done, and one already gone,
  -- or being removed right now, asks for a reload. Nothing here waits on a
  -- character while holding the lineup lock (nowait), so a removal, which
  -- holds the character and then waits for the lineup lock, can never be
  -- waited on in turn (CodeRabbit on PR #1874).
  begin
    perform 1 from characters
    where id in (
      select x.character_id from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(character_id integer)
    )
    for share nowait;
    -- And the roster rows given an alt, so a move to another person can't
    -- land between the ownership check and the write.
    perform 1 from players
    where id in (
      select x.player_id from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(player_id integer, character_id integer)
      where x.character_id is not null
    )
    for share nowait;
  exception when lock_not_available then
    raise exception 'Someone else changed this raider''s characters since you opened it. Reload to see their change.';
  end;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(character_id integer)
    where x.character_id is not null and not exists (select 1 from characters c where c.id = x.character_id)
  ) then
    raise exception 'Someone else changed this raider''s characters since you opened it. Reload to see their change.';
  end if;
  perform public.check_lineup_picks(p_team_id, p_player_ids, coalesce(p_picks, '[]'::jsonb));

  select coalesce(array_agg(player_id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'character_id', character_id,
                                               'class_spec_id', class_spec_id))
                    filter (where character_id is not null or class_spec_id is not null), '[]'::jsonb)
    into v_current, v_current_picks
  from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;

  if (p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids))
     or (p_expected_picks is not null and not public.same_lineup_picks(v_current_picks, p_expected_picks))
     or (p_picks is null and v_current_picks <> '[]'::jsonb) then
    raise exception 'Someone else changed this group since you opened it. Reload to see their change.';
  end if;

  delete from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;
  insert into boss_groups (team_id, encounter_id, player_id, character_id, class_spec_id)
  select p_team_id, p_encounter_id, x, n.character_id, n.class_spec_id
  from unnest(p_player_ids) x
  left join public.lineup_picks_norm(p_team_id, p_picks) n on n.player_id = x;

  select coalesce(array_agg(raid_date order by raid_date), '{}') into v_nights
  from raid_night_bosses
  where team_id = p_team_id and encounter_id = p_encounter_id
    and raid_date >= public.raid_today() and confirmed_at is null and not skipped;

  delete from raid_night_lineups
  where team_id = p_team_id and encounter_id = p_encounter_id and raid_date = any (v_nights);
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id, character_id, class_spec_id)
  select p_team_id, d, p_encounter_id, g.player_id, g.character_id, g.class_spec_id
  from unnest(v_nights) d
  cross join boss_groups g
  join players p on p.id = g.player_id and not p.is_bench
  where g.team_id = p_team_id and g.encounter_id = p_encounter_id;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Group',
    'boss_groups',
    p_encounter_id,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'picks', coalesce(p_picks, '[]'::jsonb),
      'nights_following', to_jsonb(v_nights)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;
