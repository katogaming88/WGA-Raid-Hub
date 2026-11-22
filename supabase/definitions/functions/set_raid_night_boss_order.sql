-- Function public.set_raid_night_boss_order: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_raid_night_boss_order(p_team_id integer, p_raid_date date, p_encounter_ids integer[], p_expected_ids integer[], p_every_night boolean DEFAULT false, p_plan text DEFAULT 'mythic'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer[];
  v_places integer[];
  v_night integer[];
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

  if p_plan is null or p_plan not in ('heroic', 'mythic') then
    raise exception 'Pick the Heroic or the Mythic plan.';
  end if;

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  -- The half's bosses in pull order, and the places they hold.
  select coalesce(array_agg(encounter_id order by position, encounter_id), '{}'),
         coalesce(array_agg(position order by position, encounter_id), '{}')
    into v_current, v_places
  from raid_night_bosses
  where team_id = p_team_id and raid_date = p_raid_date and plan = p_plan;

  if cardinality(v_current) = 0 then
    raise exception 'That night has no bosses planned yet.';
  end if;

  if p_expected_ids is null or v_current <> p_expected_ids then
    raise exception 'Someone else changed this night''s pull order since you opened it. Reload to see their change.';
  end if;

  if coalesce(cardinality(p_encounter_ids), 0) <> cardinality(v_current)
     or (select array_agg(x order by x) from unnest(p_encounter_ids) x)
        is distinct from (select array_agg(x order by x) from unnest(v_current) x) then
    raise exception 'The order has to list every boss on the night once.';
  end if;

  -- The listed bosses swap places among the places they hold, on both
  -- halves; a boss only on the other half keeps its place.
  update raid_night_bosses b
     set position = v_places[o.ord]
    from unnest(p_encounter_ids) with ordinality as o(encounter_id, ord)
   where b.team_id = p_team_id and b.raid_date = p_raid_date and b.encounter_id = o.encounter_id;

  if coalesce(p_every_night, false) then
    -- The team's order is the whole night's after this save, both halves,
    -- so a boss only on the other half keeps its place on later nights too
    -- (CodeRabbit on PR #1887).
    select array_agg(encounter_id order by position, encounter_id) into v_night
    from (
      select encounter_id, min(position) as position
      from raid_night_bosses
      where team_id = p_team_id and raid_date = p_raid_date
      group by encounter_id
    ) b;

    insert into team_boss_order (team_id, encounter_id, position, updated_at)
    select p_team_id, o.encounter_id, o.ord, now()
    from unnest(v_night) with ordinality as o(encounter_id, ord)
    on conflict (team_id, encounter_id) do update set position = excluded.position, updated_at = excluded.updated_at;

    -- A boss saved before but not on this night goes after every one on it,
    -- keeping its order among the others, so no older place ties with or
    -- comes ahead of a newer one (CodeRabbit on PR #1880).
    update team_boss_order t
       set position = r.n
      from (
        select encounter_id,
               row_number() over (order by array_position(v_night, encounter_id) nulls last, position, encounter_id) as n
        from team_boss_order
        where team_id = p_team_id
      ) r
     where t.team_id = p_team_id and t.encounter_id = r.encounter_id and t.position <> r.n;

    -- Every coming night already filled, in the team's order, one place per
    -- boss shared by both halves; a boss the team order doesn't list keeps
    -- its place after the ones it does.
    update raid_night_bosses b
       set position = r.ord
      from (
        select n.id,
               dense_rank() over (partition by n.raid_date
                                  order by o.position nulls last, n.position, n.encounter_id) as ord
        from raid_night_bosses n
        left join team_boss_order o on o.team_id = n.team_id and o.encounter_id = n.encounter_id
        where n.team_id = p_team_id and n.raid_date > p_raid_date and n.raid_date >= public.raid_today()
      ) r
     where b.id = r.id;
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Set Raid Night Boss Order',
    'raid_night_bosses',
    null,
    jsonb_build_object(
      'raid_date', p_raid_date,
      'plan', p_plan,
      'bosses', (select jsonb_agg(e.name order by o.ord)
                   from unnest(p_encounter_ids) with ordinality as o(encounter_id, ord)
                   join raid_encounters e on e.id = o.encounter_id),
      'was', to_jsonb(v_current),
      'every_night', coalesce(p_every_night, false)
    )
  );
end;
$function$;
