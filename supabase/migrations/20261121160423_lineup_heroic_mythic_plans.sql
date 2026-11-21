-- #1688: a Heroic plan and a Mythic plan for each boss (Kat, 2026-11-21).
--
-- Until now a team had one usual group per boss, and every raid night copied
-- it whatever the night's difficulty. Now each group, each night's boss list,
-- each night's lineup and each night's record of who was actually in carries
-- a plan: 'heroic' (Normal nights use it too, both take 10 to 30) or 'mythic'.
--
-- A night copies the plan for its difficulty: a Heroic night the Heroic
-- plan, a Mythic night (or one with no difficulty set) the Mythic plan, and a
-- Heroic into Mythic night both, so it has a Heroic and a Mythic lineup per
-- boss.
--
-- Every row there today becomes 'mythic': the lineups have always been
-- planned against Mythic's 20, and Phoenix, the one team using them, raids
-- Mythic. The Heroic plan starts empty (Kat's pick), so nothing anyone sees
-- changes until an officer fills it. The pull order, role targets and raider
-- order stay one per team, shared by both plans.

-- The tables -----------------------------------------------------------------

alter table public.boss_groups
  add column plan text not null default 'mythic' check (plan in ('heroic', 'mythic'));
alter table public.raid_night_bosses
  add column plan text not null default 'mythic' check (plan in ('heroic', 'mythic'));
alter table public.raid_night_lineups
  add column plan text not null default 'mythic' check (plan in ('heroic', 'mythic'));
alter table public.raid_night_participation
  add column plan text not null default 'mythic' check (plan in ('heroic', 'mythic'));

-- The default stays 'mythic': a write that names no plan is the Mythic plan,
-- what every lineup was before this.

comment on column public.boss_groups.plan is
  'Which plan this group belongs to (#1688): heroic (Normal and Heroic nights) or mythic.';
comment on column public.raid_night_bosses.plan is
  'Which half of the night this boss is on (#1688): heroic or mythic. A Heroic into Mythic night lists each boss once per half.';
comment on column public.raid_night_lineups.plan is
  'The half of the night this place is in (#1688), matching its raid_night_bosses row.';
comment on column public.raid_night_participation.plan is
  'The half of the night the fight was in (#1688): mythic for a Mythic fight, heroic for any other.';

alter table public.raid_night_lineups drop constraint raid_night_lineups_team_id_raid_date_encounter_id_fkey;
alter table public.raid_night_participation drop constraint raid_night_participation_team_id_raid_date_encounter_id_fkey;

alter table public.boss_groups drop constraint boss_groups_team_id_encounter_id_player_id_key;
alter table public.boss_groups
  add constraint boss_groups_team_encounter_plan_player_key unique (team_id, encounter_id, plan, player_id);

alter table public.raid_night_bosses drop constraint raid_night_bosses_team_id_raid_date_encounter_id_key;
alter table public.raid_night_bosses
  add constraint raid_night_bosses_team_date_encounter_plan_key unique (team_id, raid_date, encounter_id, plan);

alter table public.raid_night_lineups drop constraint raid_night_lineups_team_id_raid_date_encounter_id_player_id_key;
alter table public.raid_night_lineups
  add constraint raid_night_lineups_team_date_encounter_plan_player_key unique (team_id, raid_date, encounter_id, plan, player_id);
alter table public.raid_night_lineups
  add constraint raid_night_lineups_night_boss_fkey foreign key (team_id, raid_date, encounter_id, plan)
  references public.raid_night_bosses (team_id, raid_date, encounter_id, plan) on delete cascade;

alter table public.raid_night_participation drop constraint raid_night_participation_team_id_raid_date_encounter_id_pla_key;
alter table public.raid_night_participation
  add constraint raid_night_participation_team_date_encounter_plan_player_key unique (team_id, raid_date, encounter_id, plan, player_id);
alter table public.raid_night_participation
  add constraint raid_night_participation_night_boss_fkey foreign key (team_id, raid_date, encounter_id, plan)
  references public.raid_night_bosses (team_id, raid_date, encounter_id, plan) on delete cascade;

-- The plans a night holds ---------------------------------------------------

-- A Heroic night the Heroic plan, a Heroic into Mythic night both (Heroic
-- first, the order it is raided in), anything else the Mythic plan.
-- raid_night_info() reads Heroic into Mythic as Mythic (the difficulty its
-- kills count at), so the night's own difficulty is read here the way it
-- finds it: a date added on its own, else the weekly night, else the team
-- default.
create function public.raid_night_plans(p_team_id integer, p_raid_date date)
returns text[]
language sql
stable
set search_path = public
as $$
  with def as (
    select (select default_difficulty from team_schedule_settings where team_id = p_team_id) as d
  ),
  night as (
    select case
             when exists (select 1 from raid_schedule_exceptions
                          where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'added')
               then (select coalesce(e.difficulty, def.d) from raid_schedule_exceptions e
                     where e.team_id = p_team_id and e.raid_date = p_raid_date and e.exception_type = 'added')
             else (select coalesce(r.difficulty, def.d) from raid_schedule r
                   where r.team_id = p_team_id and r.active and r.weekday = extract(dow from p_raid_date))
           end as difficulty
    from def
  )
  select case night.difficulty
           when 'heroic' then array['heroic']
           when 'heroic_into_mythic' then array['heroic', 'mythic']
           else array['mythic']
         end
  from night;
$$;

revoke all on function public.raid_night_plans(integer, date) from public, anon, authenticated;

comment on function public.raid_night_plans(integer, date) is
  'The plans a raid night copies (#1688): heroic, mythic, or both for a Heroic into Mythic night.';

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
  v_difficulty text;
begin
  if exists (select 1 from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date) then
    return 0;
  end if;

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

  v_plans := public.raid_night_plans(p_team_id, p_raid_date);
  select i.difficulty into v_difficulty from raid_night_info(p_team_id, p_raid_date) i;

  -- One row per boss per plan the night copies, for each boss that plan has
  -- a group for. A boss already killed on that plan's difficulty this
  -- lockout starts skipped, on a night with a difficulty set.
  insert into raid_night_bosses (team_id, raid_date, encounter_id, plan, position, skipped, skipped_for_kill_id)
  select p_team_id, p_raid_date, e.id, pl.plan,
         -- One shared place per boss across both halves, so a half without
         -- a boss keeps the others' places (CodeRabbit on PR #1885).
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

  get diagnostics v_count = row_count;

  insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
  select p_team_id, p_raid_date, b.encounter_id, b.plan, g.player_id, g.character_id, g.class_spec_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id and g.plan = b.plan
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date and not b.skipped;

  perform log_killed_boss_skips(array(
    select id from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and skipped_for_kill_id is not null));

  return v_count;
end;
$$;

-- A kill skips the boss on the half of the night run at the kill's
-- difficulty, and only that half.
create or replace function public.skip_killed_bosses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team integer;
  v_skipped integer[];
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from new_kills order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  -- A night already under way is left alone: tonight counts until its
  -- scheduled start, and a night with no start time counts as started. A
  -- night with no difficulty set is never skipped.
  with nights as (
    select b.id, b.team_id, b.raid_date, b.encounter_id, b.plan
    from raid_night_bosses b
    cross join lateral raid_night_info(b.team_id, b.raid_date) i
    where i.difficulty is not null
      and (b.team_id, b.encounter_id) in (select team_id, encounter_id from new_kills)
      and (b.raid_date > raid_today()
           or (b.raid_date = raid_today() and now() < (b.raid_date + i.start_time) at time zone i.timezone))
      and b.confirmed_at is null
      and not b.skipped
  ),
  first_kills as (
    -- Only when every kill of the boss before the night arrived in this
    -- insert: another log of a kill already counted changes nothing.
    select n.id as night_id, (array_agg(k.id order by k.report_started_at, k.fight_id))[1] as kill_id
    from nights n
    cross join lateral kills_before_night(n.team_id, n.encounter_id, n.raid_date, n.plan) k
    left join new_kills nk on nk.id = k.id
    group by n.id
    having bool_and(nk.id is not null)
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.kill_id
      from first_kills f
     where b.id = f.night_id
    returning b.id
  )
  select array_agg(id) into v_skipped from skipped;

  delete from raid_night_lineups l
  using raid_night_bosses b
  where b.id = any (v_skipped)
    and l.team_id = b.team_id and l.raid_date = b.raid_date and l.encounter_id = b.encounter_id and l.plan = b.plan;

  perform log_killed_boss_skips(v_skipped);

  return null;
end;
$$;

-- Saving a group ------------------------------------------------------------

drop function public.set_boss_group(integer, integer, integer[], integer[], jsonb, jsonb);

create function public.set_boss_group(
  p_team_id integer,
  p_encounter_id integer,
  p_player_ids integer[],
  p_expected_player_ids integer[] default null,
  p_picks jsonb default null,
  p_expected_picks jsonb default null,
  p_plan text default 'mythic'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

  if p_plan is null or p_plan not in ('heroic', 'mythic') then
    raise exception 'Pick the Heroic or the Mythic plan.';
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
  from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id and plan = p_plan;

  if (p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids))
     or (p_expected_picks is not null and not public.same_lineup_picks(v_current_picks, p_expected_picks))
     or (p_picks is null and v_current_picks <> '[]'::jsonb) then
    raise exception 'Someone else changed this group since you opened it. Reload to see their change.';
  end if;

  delete from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id and plan = p_plan;
  insert into boss_groups (team_id, encounter_id, plan, player_id, character_id, class_spec_id)
  select p_team_id, p_encounter_id, p_plan, x, n.character_id, n.class_spec_id
  from unnest(p_player_ids) x
  left join public.lineup_picks_norm(p_team_id, p_picks) n on n.player_id = x;

  -- Coming nights still on the automatic copy of this plan follow it.
  select coalesce(array_agg(raid_date order by raid_date), '{}') into v_nights
  from raid_night_bosses
  where team_id = p_team_id and encounter_id = p_encounter_id and plan = p_plan
    and raid_date >= public.raid_today() and confirmed_at is null and not skipped;

  delete from raid_night_lineups
  where team_id = p_team_id and encounter_id = p_encounter_id and plan = p_plan and raid_date = any (v_nights);
  insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
  select p_team_id, d, p_encounter_id, p_plan, g.player_id, g.character_id, g.class_spec_id
  from unnest(v_nights) d
  cross join boss_groups g
  join players p on p.id = g.player_id and not p.is_bench
  where g.team_id = p_team_id and g.encounter_id = p_encounter_id and g.plan = p_plan;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Group',
    'boss_groups',
    p_encounter_id,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'plan', p_plan,
      'player_ids', to_jsonb(p_player_ids),
      'picks', coalesce(p_picks, '[]'::jsonb),
      'nights_following', to_jsonb(v_nights)
    )
  );

  return cardinality(p_player_ids);
end;
$$;

revoke all on function public.set_boss_group(integer, integer, integer[], integer[], jsonb, jsonb, text) from public, anon;
grant execute on function public.set_boss_group(integer, integer, integer[], integer[], jsonb, jsonb, text) to authenticated;

-- Saving one night's lineup for a boss --------------------------------------

drop function public.set_raid_night_lineup(integer, date, integer, integer[], integer[], jsonb, jsonb);

create function public.set_raid_night_lineup(
  p_team_id integer,
  p_raid_date date,
  p_encounter_id integer,
  p_player_ids integer[],
  p_expected_player_ids integer[] default null,
  p_picks jsonb default null,
  p_expected_picks jsonb default null,
  p_plan text default 'mythic'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer[];
  v_current_picks jsonb;
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

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  -- A half the night is raided at, or one it already has (its difficulty
  -- changed after it was filled), so what is planned can still be edited.
  if p_plan is null
     or not (p_plan = any (public.raid_night_plans(p_team_id, p_raid_date))
             or exists (select 1 from raid_night_bosses
                        where team_id = p_team_id and raid_date = p_raid_date and plan = p_plan)) then
    raise exception 'That night isn''t raided on that difficulty.';
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
  from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan;

  if (p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids))
     or (p_expected_picks is not null and not public.same_lineup_picks(v_current_picks, p_expected_picks))
     or (p_picks is null and v_current_picks <> '[]'::jsonb) then
    raise exception 'Someone else changed this boss''s lineup since you opened it. Reload to see their change.';
  end if;

  -- A boss new to this half takes its place from the other half, else goes
  -- last.
  insert into raid_night_bosses (team_id, raid_date, encounter_id, plan, position, confirmed_at, confirmed_by)
  values (
    p_team_id, p_raid_date, p_encounter_id, p_plan,
    coalesce(
      (select min(position) from raid_night_bosses
        where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id),
      (select max(position) from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date),
      0
    ) + case when exists (select 1 from raid_night_bosses
                           where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id)
             then 0 else 1 end,
    now(), public.my_person_id()
  )
  on conflict (team_id, raid_date, encounter_id, plan)
  do update set skipped = false, skipped_for_kill_id = null, confirmed_at = now(), confirmed_by = public.my_person_id();

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan;
  insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
  select p_team_id, p_raid_date, p_encounter_id, p_plan, x, n.character_id, n.class_spec_id
  from unnest(p_player_ids) x
  left join public.lineup_picks_norm(p_team_id, p_picks) n on n.player_id = x;

  perform public.write_audit_log(
    p_team_id,
    'Set Raid Night Lineup',
    'raid_night_lineups',
    p_encounter_id,
    jsonb_build_object(
      'raid_date', p_raid_date,
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'plan', p_plan,
      'player_ids', to_jsonb(p_player_ids),
      'was', to_jsonb(v_current),
      'picks', coalesce(p_picks, '[]'::jsonb),
      'picks_were', v_current_picks
    )
  );

  return cardinality(p_player_ids);
end;
$$;

revoke all on function public.set_raid_night_lineup(integer, date, integer, integer[], integer[], jsonb, jsonb, text) from public, anon;
grant execute on function public.set_raid_night_lineup(integer, date, integer, integer[], integer[], jsonb, jsonb, text) to authenticated;

-- Skipping a boss on one half -----------------------------------------------

drop function public.set_raid_night_boss_skipped(integer, date, integer, boolean);

create function public.set_raid_night_boss_skipped(
  p_team_id integer,
  p_raid_date date,
  p_encounter_id integer,
  p_skipped boolean,
  p_plan text default 'mythic'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  if p_skipped is null then
    raise exception 'Say whether the boss is skipped.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  if not p_skipped then
    -- The group's picked alts, held without waiting (see the saves).
    begin
      perform 1 from characters
      where id in (
        select g.character_id from boss_groups g
        where g.team_id = p_team_id and g.encounter_id = p_encounter_id and g.plan = p_plan
          and g.character_id is not null
      )
      for key share nowait;
    exception when lock_not_available then
      raise exception 'A raider''s characters are being updated right now. Try again in a moment.';
    end;
  end if;

  update raid_night_bosses
     set skipped = p_skipped, skipped_for_kill_id = null, confirmed_at = null, confirmed_by = null
   where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan;

  if not found then
    raise exception 'That boss is not on this night''s plan.';
  end if;

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan;

  if not p_skipped then
    insert into raid_night_lineups (team_id, raid_date, encounter_id, plan, player_id, character_id, class_spec_id)
    select p_team_id, p_raid_date, p_encounter_id, p_plan, g.player_id, g.character_id, g.class_spec_id
    from boss_groups g
    join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
    where g.team_id = p_team_id and g.encounter_id = p_encounter_id and g.plan = p_plan;
  end if;

  perform public.write_audit_log(
    p_team_id,
    case when p_skipped then 'Skip Raid Night Boss' else 'Unskip Raid Night Boss' end,
    'raid_night_bosses',
    p_encounter_id,
    jsonb_build_object('raid_date', p_raid_date, 'boss', (select name from raid_encounters where id = p_encounter_id),
                       'plan', p_plan)
  );
end;
$$;

revoke all on function public.set_raid_night_boss_skipped(integer, date, integer, boolean, text) from public, anon;
grant execute on function public.set_raid_night_boss_skipped(integer, date, integer, boolean, text) to authenticated;

-- The pull order: one per night, shared by both halves ----------------------

create or replace function public.set_raid_night_boss_order(
  p_team_id integer,
  p_raid_date date,
  p_encounter_ids integer[],
  p_expected_ids integer[],
  p_every_night boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer[];
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

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  -- Each boss once, at its earliest place on either half.
  select coalesce(array_agg(encounter_id order by position, encounter_id), '{}') into v_current
  from (
    select encounter_id, min(position) as position
    from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date
    group by encounter_id
  ) b;

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

  update raid_night_bosses b
     set position = o.ord
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
      'bosses', (select jsonb_agg(e.name order by o.ord)
                   from unnest(p_encounter_ids) with ordinality as o(encounter_id, ord)
                   join raid_encounters e on e.id = o.encounter_id),
      'was', to_jsonb(v_current),
      'every_night', coalesce(p_every_night, false)
    )
  );
end;
$$;

-- Who was actually in, per half ---------------------------------------------

drop function public.record_raid_night_participation(integer, date, integer, integer[]);

create function public.record_raid_night_participation(
  p_team_id integer,
  p_raid_date date,
  p_encounter_id integer,
  p_player_ids integer[],
  p_plan text default 'mythic'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;

    if not (
      public.has_team_permission(p_team_id, 'attendance')
      or public.is_site_admin()
    ) then
      raise exception 'Not authorized';
    end if;
  end if;

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id and plan = p_plan;
  insert into raid_night_participation (team_id, raid_date, encounter_id, plan, player_id)
  select p_team_id, p_raid_date, p_encounter_id, p_plan, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$$;

revoke all on function public.record_raid_night_participation(integer, date, integer, integer[], text) from public, anon;
grant execute on function public.record_raid_night_participation(integer, date, integer, integer[], text) to authenticated, service_role;
