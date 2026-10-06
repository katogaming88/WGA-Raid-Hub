-- #1246: a boss the team killed earlier in the lockout comes off its later
-- raid nights that lockout, at the night's difficulty.
--
-- team_raid_kills keeps every kill the progression sync reads, and each night
-- says its difficulty, but an officer still took each killed boss off the
-- coming nights by hand. Each insert into team_raid_kills now does it for the
-- first kill of a boss, difficulty and lockout: on the team's later nights that
-- lockout that are not yet played and whose difficulty matches, where no
-- officer has saved or skipped the boss. The boss stays on the night's list as
-- skipped, with the kill in skipped_for_kill_id, so Put back works as it does
-- for a hand skip, and a later log of the same kill leaves it put back. A night
-- planned after the kill arrives with the boss skipped.
--
-- The skip runs inside the sync's insert, so the trigger turns any error from
-- it into a warning: a bug in the skip never loses a kill.

alter table public.raid_night_bosses
  add column skipped_for_kill_id integer references public.team_raid_kills(id) on delete set null;

create index raid_night_bosses_skipped_for_kill_id_idx on public.raid_night_bosses (skipped_for_kill_id);

comment on column public.raid_night_bosses.skipped_for_kill_id is
  'The kill that took this boss off the night (#1246): the team killed it earlier in the lockout at the night''s difficulty. Null when an officer skipped it, and when it is not skipped.';

create function public.skip_killed_bosses(p_kill_ids integer[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team integer;
  v_count integer;
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from team_raid_kills where id = any (p_kill_ids) order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  with first_kills as (
    -- The earliest of these kills per team, boss, difficulty and lockout, when
    -- no other kill of that boss is stored for the lockout.
    select distinct on (k.team_id, k.encounter_id, k.difficulty, lockout_week_start(k.raid_date))
           k.id, k.team_id, k.encounter_id, k.difficulty, k.raid_date, k.report_code
    from team_raid_kills k
    where k.id = any (p_kill_ids)
      and not exists (
        select 1 from team_raid_kills o
        where o.team_id = k.team_id and o.encounter_id = k.encounter_id and o.difficulty = k.difficulty
          and lockout_week_start(o.raid_date) = lockout_week_start(k.raid_date)
          and not (o.id = any (p_kill_ids))
      )
    order by k.team_id, k.encounter_id, k.difficulty, lockout_week_start(k.raid_date), k.report_started_at, k.fight_id
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.id
      from first_kills f
     where b.team_id = f.team_id
       and b.encounter_id = f.encounter_id
       and b.raid_date > f.raid_date
       and b.raid_date >= raid_today()
       and lockout_week_start(b.raid_date) = lockout_week_start(f.raid_date)
       and b.confirmed_at is null
       and not b.skipped
       and (select i.difficulty from raid_night_info(b.team_id, b.raid_date) i) = f.difficulty
    returning b.team_id, b.raid_date, b.encounter_id, f.raid_date as killed_on, f.difficulty, f.report_code
  ),
  cleared as (
    delete from raid_night_lineups l
    using skipped s
    where l.team_id = s.team_id and l.raid_date = s.raid_date and l.encounter_id = s.encounter_id
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select s.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', s.encounter_id,
         jsonb_build_object('raid_date', s.raid_date, 'boss', e.name, 'killed_on', s.killed_on,
                            'difficulty', s.difficulty, 'report_code', s.report_code)
  from skipped s
  join raid_encounters e on e.id = s.encounter_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.skip_killed_bosses(integer[]) owner to postgres;
revoke all on function public.skip_killed_bosses(integer[]) from public, anon, authenticated;

comment on function public.skip_killed_bosses(integer[]) is
  'Takes a boss off the team''s later raid nights in the same lockout for each given kill that is the first of its boss and difficulty that lockout (#1246): a night not yet played, at the kill''s difficulty, where no officer has saved or skipped the boss. Marks it skipped with the kill in skipped_for_kill_id, removes its lineup and logs Skip Killed Boss with no actor. Run by the insert trigger on team_raid_kills; callable by hand for a repair. Returns how many nights it changed.';

create function public.team_raid_kills_skip_killed_bosses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.skip_killed_bosses(array(select id from new_kills));
  exception when others then
    raise warning 'Kills % were stored, but taking their bosses off later nights failed: %',
      (select array_agg(id order by id) from new_kills), sqlerrm;
  end;
  return null;
end;
$$;

alter function public.team_raid_kills_skip_killed_bosses() owner to postgres;
revoke all on function public.team_raid_kills_skip_killed_bosses() from public, anon, authenticated;

comment on function public.team_raid_kills_skip_killed_bosses() is
  'Runs skip_killed_bosses() for the kills one insert into team_raid_kills stored (#1246). An error from it becomes a warning, so the kills are kept.';

create trigger team_raid_kills_skip_killed_bosses
  after insert on public.team_raid_kills
  referencing new table as new_kills
  for each statement
  execute function public.team_raid_kills_skip_killed_bosses();

comment on table public.team_raid_kills is
  'Every Heroic and Mythic boss kill in a team''s Warcraft Logs reports (#1246), one row per fight, dated by the report''s raid night. Written only by wcl-progression-sync. team_raid_progress holds the first kill per boss; this holds them all. Each insert takes the bosses it killed off the team''s later nights that lockout (skip_killed_bosses()).';

create or replace function public.fill_raid_night(p_team_id integer, p_raid_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_difficulty text;
begin
  if exists (select 1 from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date) then
    return 0;
  end if;

  select i.difficulty into v_difficulty from raid_night_info(p_team_id, p_raid_date) i;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position, skipped, skipped_for_kill_id)
  select p_team_id, p_raid_date, e.id, row_number() over (order by z.sort_index, z.id, e.sort_index, e.id),
         k.id is not null, k.id
  from raid_encounters e
  join raid_zones z on z.id = e.zone_id
  join seasons s on s.code = z.season
  left join lateral (
    select k.id
    from team_raid_kills k
    where k.team_id = p_team_id and k.encounter_id = e.id and k.difficulty = v_difficulty
      and k.raid_date < p_raid_date
      and lockout_week_start(k.raid_date) = lockout_week_start(p_raid_date)
    order by k.report_started_at, k.fight_id
    limit 1
  ) k on true
  where p_raid_date between s.starts_at and coalesce(s.ends_at, 'infinity'::date)
    and exists (select 1 from boss_groups g where g.team_id = p_team_id and g.encounter_id = e.id);

  get diagnostics v_count = row_count;

  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, b.encounter_id, g.player_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date and not b.skipped;

  return v_count;
end;
$$;

comment on function public.fill_raid_night(integer, date) is
  'Fills a raid night''s boss list and lineups from the team''s standing groups (#1216), if the night has no plan yet. A boss the team killed earlier in the lockout at the night''s difficulty arrives skipped, with that kill in skipped_for_kill_id (#1246). Internal: called by fill_upcoming_raid_nights() (pg_cron) and plan_raid_night().';

create or replace function public.set_raid_night_boss_skipped(p_team_id integer, p_raid_date date, p_encounter_id integer, p_skipped boolean)
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
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_skipped is null then
    raise exception 'Say whether the boss is skipped.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  update raid_night_bosses
     set skipped = p_skipped, skipped_for_kill_id = null, confirmed_at = null, confirmed_by = null
   where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not found then
    raise exception 'That boss is not on this night''s plan.';
  end if;

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not p_skipped then
    insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
    select p_team_id, p_raid_date, p_encounter_id, g.player_id
    from boss_groups g
    join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
    where g.team_id = p_team_id and g.encounter_id = p_encounter_id;
  end if;

  perform public.write_audit_log(
    p_team_id,
    case when p_skipped then 'Skip Raid Night Boss' else 'Unskip Raid Night Boss' end,
    'raid_night_bosses',
    p_encounter_id,
    jsonb_build_object('raid_date', p_raid_date, 'boss', (select name from raid_encounters where id = p_encounter_id))
  );
end;
$$;

create or replace function public.set_raid_night_lineup(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] default null)
returns integer
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
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this boss''s lineup since you opened it. Reload to see their change.';
  end if;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position, confirmed_at, confirmed_by)
  values (
    p_team_id, p_raid_date, p_encounter_id,
    coalesce((select max(position) from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date), 0) + 1,
    now(), public.my_person_id()
  )
  on conflict (team_id, raid_date, encounter_id)
  do update set skipped = false, skipped_for_kill_id = null, confirmed_at = now(), confirmed_by = public.my_person_id();

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  perform public.write_audit_log(
    p_team_id,
    'Set Raid Night Lineup',
    'raid_night_lineups',
    p_encounter_id,
    jsonb_build_object(
      'raid_date', p_raid_date,
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'was', to_jsonb(v_current)
    )
  );

  return cardinality(p_player_ids);
end;
$$;
