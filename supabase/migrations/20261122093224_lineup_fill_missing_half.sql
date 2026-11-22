-- #1688 (part 2): a night gains a half it is missing, and a pull-order save
-- works on one half.
--
-- Part 1 (20261121160423_lineup_heroic_mythic_plans.sql) filled a night only
-- while it had no rows at all. A team that fills its Heroic plan after its
-- Mythic one, or moves a night to Heroic into Mythic, would never see the
-- Heroic half on nights already filled (up to a week ahead) until an officer
-- saved each boss by hand. Now each plan the night copies is filled while
-- that half has no rows, so the hourly job adds the missing half within the
-- hour, and "Fill from the groups" adds it at once.
--
-- The Boss Lineup page shows one half at a time, so its pull-order save lists
-- that half's bosses. set_raid_night_boss_order() used to want every boss on
-- the night, so a save from a half without one of the other half's bosses
-- was refused as stale. It now takes the half (p_plan, default Mythic, so
-- today's callers are unchanged): the listed bosses swap places among the
-- places they hold, on both halves, and a boss only on the other half keeps
-- its place.
--
-- fill_raid_night() also returns bosses rather than rows, so "Filled 10
-- bosses" and the Plan Raid Night audit entry don't count a boss twice on a
-- night with both halves.

-- Filling a night -----------------------------------------------------------

create or replace function public.fill_raid_night(p_team_id integer, p_raid_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_plans text[];
  v_had boolean;
  v_difficulty text;
begin
  -- The plans this night copies that it has no rows for yet.
  select array_agg(pl.plan) into v_plans
  from unnest(public.raid_night_plans(p_team_id, p_raid_date)) as pl(plan)
  where not exists (
    select 1 from raid_night_bosses b
    where b.team_id = p_team_id and b.raid_date = p_raid_date and b.plan = pl.plan
  );
  if coalesce(cardinality(v_plans), 0) = 0 then
    return 0;
  end if;
  v_had := exists (select 1 from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date);

  -- The alts the groups pick, held without waiting (see the saves): one
  -- being removed right now leaves this night for the next fill, an hour on
  -- or an officer's Fill from the groups.
  begin
    perform 1 from characters
    where id in (select g.character_id from boss_groups g where g.team_id = p_team_id and g.character_id is not null)
    for key share nowait;
  exception when lock_not_available then
    return 0;
  end;

  select i.difficulty into v_difficulty from raid_night_info(p_team_id, p_raid_date) i;

  -- One row per boss per plan filled, for each boss that plan has a group
  -- for, one place per boss shared by both halves (CodeRabbit on PR #1885).
  -- A boss already killed on that plan's difficulty this lockout starts
  -- skipped, on a night with a difficulty set.
  insert into raid_night_bosses (team_id, raid_date, encounter_id, plan, position, skipped, skipped_for_kill_id)
  select p_team_id, p_raid_date, e.id, pl.plan,
         dense_rank() over (order by o.position nulls last, z.sort_index, z.id, e.sort_index, e.id),
         k.id is not null, k.id
  from unnest(v_plans) as pl(plan)
  cross join raid_encounters e
  join raid_zones z on z.id = e.zone_id
  left join team_boss_order o on o.team_id = p_team_id and o.encounter_id = e.id
  join seasons s on s.code = z.season
  left join lateral (
    select k.id
    from kills_before_night(p_team_id, e.id, p_raid_date, pl.plan) k
    where v_difficulty is not null
    order by k.report_started_at, k.fight_id
    limit 1
  ) k on true
  where p_raid_date between s.starts_at and coalesce(s.ends_at, 'infinity'::date)
    and exists (select 1 from boss_groups g where g.team_id = p_team_id and g.encounter_id = e.id and g.plan = pl.plan);

  select count(distinct encounter_id) into v_count
  from raid_night_bosses
  where team_id = p_team_id and raid_date = p_raid_date and plan = any(v_plans);

  -- A half added beside one already there follows its pull order: a boss on
  -- both takes the place it already had, and a boss new to the night goes
  -- after the rest, in the team's order.
  if v_had then
    update raid_night_bosses b
       set position = r.n
      from (
        select encounter_id,
               dense_rank() over (order by min(position) filter (where plan <> all(v_plans)) nulls last,
                                           min(position), encounter_id) as n
        from raid_night_bosses
        where team_id = p_team_id and raid_date = p_raid_date
        group by encounter_id
      ) r
     where b.team_id = p_team_id and b.raid_date = p_raid_date and b.encounter_id = r.encounter_id
       and b.position <> r.n;
  end if;

  insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
  select p_team_id, p_raid_date, b.encounter_id, b.plan, g.player_id, g.character_id, g.class_spec_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id and g.plan = b.plan
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date and b.plan = any(v_plans) and not b.skipped;

  perform log_killed_boss_skips(array(
    select id from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and plan = any(v_plans)
      and skipped_for_kill_id is not null));

  return v_count;
end;
$$;

comment on function public.fill_raid_night(integer, date) is
  'Fills each half (plan) of a raid night that has no rows yet from the team''s standing groups for that plan (#1216, #1688), and returns the bosses filled. A half added beside one already there keeps its pull order. A boss the team killed earlier in the lockout at that half''s difficulty arrives skipped, with that kill in skipped_for_kill_id and a Skip Killed Boss audit entry (#1246). Internal: called by fill_upcoming_raid_nights() (pg_cron) and plan_raid_night().';

-- A night's pull order, from one half ----------------------------------------

drop function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean);

create function public.set_raid_night_boss_order(
  p_team_id integer,
  p_raid_date date,
  p_encounter_ids integer[],
  p_expected_ids integer[],
  p_every_night boolean default false,
  p_plan text default 'mythic'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer[];
  v_places integer[];
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
    insert into team_boss_order (team_id, encounter_id, position, updated_at)
    select p_team_id, o.encounter_id, o.ord, now()
    from unnest(p_encounter_ids) with ordinality as o(encounter_id, ord)
    on conflict (team_id, encounter_id) do update set position = excluded.position, updated_at = excluded.updated_at;

    -- A boss saved before but not on this night goes after every one this
    -- save lists, keeping its order among the others, so no older place ties
    -- with or comes ahead of a newer one (CodeRabbit on PR #1880).
    update team_boss_order t
       set position = r.n
      from (
        select encounter_id,
               row_number() over (order by array_position(p_encounter_ids, encounter_id) nulls last, position, encounter_id) as n
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
$$;

comment on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean, text) is
  'Boss Lineup (#1679): one raid night''s pull order, every boss on one half (p_plan, #1688) listed once; the listed bosses swap places on both halves, and a boss only on the other half keeps its place. Refused when that half''s order changed since p_expected_ids was read. With p_every_night it also becomes the team''s order (team_boss_order) and every coming night already filled follows it. edit_schedule or site admin.';

revoke all on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean, text) from public, anon;
grant execute on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean, text) to authenticated;
