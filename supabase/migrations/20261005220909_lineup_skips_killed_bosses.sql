-- #1246: a boss the team killed earlier in the lockout comes off its later
-- raid nights that lockout, at the night's difficulty.
--
-- team_raid_kills keeps every kill the progression sync reads, and each night
-- says its difficulty, but an officer still took each killed boss off the
-- coming nights by hand. Each insert into team_raid_kills now does it, on the
-- team's nights not yet played whose difficulty matches, where no officer has
-- saved or skipped the boss, when the insert brings the first kill of that boss
-- before the night in its lockout. The boss stays on the night's list as
-- skipped, with the kill in skipped_for_kill_id, so Put back works as it does
-- for a hand skip, and another log of a kill already counted leaves it put
-- back. A night planned after the kill arrives with the boss skipped.
--
-- An error in the skip fails the sync's insert. The sync reports it and sends
-- every kill again on its next run, which retries the skip.

alter table public.raid_night_bosses
  add column skipped_for_kill_id integer references public.team_raid_kills(id) on delete set null,
  add constraint raid_night_bosses_kill_only_when_skipped check (skipped or skipped_for_kill_id is null);

create index raid_night_bosses_skipped_for_kill_id_idx on public.raid_night_bosses (skipped_for_kill_id);

comment on column public.raid_night_bosses.skipped_for_kill_id is
  'The kill that took this boss off the night (#1246): the team killed it earlier in the lockout at the night''s difficulty. Null when an officer skipped it, and when it is not skipped.';

create function public.kills_before_night(p_team_id integer, p_encounter_id integer, p_raid_date date, p_difficulty text)
returns setof public.team_raid_kills
language sql
stable
set search_path = public
as $$
  select k.*
  from team_raid_kills k
  where k.team_id = p_team_id
    and k.encounter_id = p_encounter_id
    and k.difficulty = p_difficulty
    and k.raid_date >= lockout_week_start(p_raid_date)
    and k.raid_date < p_raid_date
    and lockout_start_at(k.report_started_at) = lockout_week_start(p_raid_date)
$$;

alter function public.kills_before_night(integer, integer, date, text) owner to postgres;
revoke all on function public.kills_before_night(integer, integer, date, text) from public, anon, authenticated;

comment on function public.kills_before_night(integer, integer, date, text) is
  'A team''s kills of a boss at one difficulty earlier in a raid night''s lockout, before the night itself (#1246). A kill counts in the lockout its report started in, so a Tuesday report from before the reset belongs to the week before. The rule the killed-boss skip and fill_raid_night() share.';

create function public.skip_killed_bosses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team integer;
begin
  -- The lock every lineup write takes, before anything is read, so a night
  -- filled at the same moment either is seen here or sees these kills.
  for v_team in select distinct team_id from new_kills order by team_id loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  with nights as (
    select b.id, b.team_id, b.raid_date, b.encounter_id,
           (select i.difficulty from raid_night_info(b.team_id, b.raid_date) i) as difficulty
    from raid_night_bosses b
    where (b.team_id, b.encounter_id) in (select team_id, encounter_id from new_kills)
      and b.raid_date >= raid_today()
      and b.confirmed_at is null
      and not b.skipped
  ),
  first_kills as (
    -- Only when every kill of the boss before the night arrived in this
    -- insert: another log of a kill already counted changes nothing.
    select n.id as night_id, (array_agg(k.id order by k.report_started_at, k.fight_id))[1] as kill_id
    from nights n
    cross join lateral kills_before_night(n.team_id, n.encounter_id, n.raid_date, n.difficulty) k
    left join new_kills nk on nk.id = k.id
    group by n.id
    having bool_and(nk.id is not null)
  ),
  skipped as (
    update raid_night_bosses b
       set skipped = true, skipped_for_kill_id = f.kill_id
      from first_kills f
     where b.id = f.night_id
    returning b.team_id, b.raid_date, b.encounter_id, b.skipped_for_kill_id
  ),
  cleared as (
    delete from raid_night_lineups l
    using skipped s
    where l.team_id = s.team_id and l.raid_date = s.raid_date and l.encounter_id = s.encounter_id
  )
  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select s.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', s.encounter_id,
         jsonb_build_object('raid_date', s.raid_date, 'boss', e.name, 'killed_on', k.raid_date,
                            'difficulty', k.difficulty, 'report_code', k.report_code)
  from skipped s
  join team_raid_kills k on k.id = s.skipped_for_kill_id
  join raid_encounters e on e.id = s.encounter_id;

  return null;
end;
$$;

alter function public.skip_killed_bosses() owner to postgres;
revoke all on function public.skip_killed_bosses() from public, anon, authenticated;

comment on function public.skip_killed_bosses() is
  'Runs after each insert into team_raid_kills (#1246). Takes a boss off the team''s raid nights not yet played, at the night''s difficulty, where no officer has saved or skipped it, when the insert brings the first kills of it before the night in that lockout (kills_before_night()). Marks it skipped with the earliest such kill in skipped_for_kill_id, removes its lineup and logs Skip Killed Boss with no actor. An error fails the insert; the progression sync sends the kills again on its next run.';

create trigger team_raid_kills_skip_killed_bosses
  after insert on public.team_raid_kills
  referencing new table as new_kills
  for each statement
  execute function public.skip_killed_bosses();

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
    from kills_before_night(p_team_id, e.id, p_raid_date, v_difficulty) k
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

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  select b.team_id, null, 'Skip Killed Boss', 'raid_night_bosses', b.encounter_id,
         jsonb_build_object('raid_date', b.raid_date, 'boss', e.name, 'killed_on', k.raid_date,
                            'difficulty', k.difficulty, 'report_code', k.report_code)
  from raid_night_bosses b
  join team_raid_kills k on k.id = b.skipped_for_kill_id
  join raid_encounters e on e.id = b.encounter_id
  where b.team_id = p_team_id and b.raid_date = p_raid_date;

  return v_count;
end;
$$;

comment on function public.fill_raid_night(integer, date) is
  'Fills a raid night''s boss list and lineups from the team''s standing groups (#1216), if the night has no plan yet. A boss the team killed earlier in the lockout at the night''s difficulty arrives skipped, with that kill in skipped_for_kill_id and a Skip Killed Boss audit entry (#1246). Internal: called by fill_upcoming_raid_nights() (pg_cron) and plan_raid_night().';

-- Team locks in team order, the order the killed-boss skip takes them in.
create or replace function public.fill_upcoming_raid_nights()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team integer;
  v_date date;
  v_total integer := 0;
begin
  for v_team in select distinct team_id from boss_groups order by team_id loop
    for v_date in select (public.raid_today() + d) from generate_series(0, 6) d loop
      if (select i.exists from public.raid_night_info(v_team, v_date) i) then
        perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
        v_total := v_total + public.fill_raid_night(v_team, v_date);
      end if;
    end loop;
  end loop;
  return v_total;
end;
$$;

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
