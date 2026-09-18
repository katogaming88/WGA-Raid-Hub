-- #1216: per-boss lineups for a raid night, stored as the plan the officers
-- actually make: "this group kills boss 5".
--
-- Phoenix runs 24 raiders into 20 seats per boss, and the seats rotate boss by
-- boss and night by night. Kat chose this shape on 2026-09-18 from Rex's review
-- of the first draft (#1231), which stored only who sat out and worked out "in"
-- from whoever was left. That draft went quietly wrong on every roster change
-- (a joiner was silently in for every boss, an archived or swapped raider
-- vanished from the plan, an Absent answer erased them) and could not say
-- afterwards who had been planned for a night that was already played.
--
-- Three tables:
--   boss_groups         the standing group per boss, kept once and changed
--                       only when the team changes.
--   raid_night_bosses   the bosses on one night's list, in order. A boss the
--                       team is not pulling that night stays on the list as
--                       skipped, so "not tonight" is recorded and a night whose
--                       bosses were all skipped is not refilled.
--   raid_night_lineups  the night's plan: one row per raider in for a boss.
--
-- A night is filled from the groups ahead of time (fill_raid_night(), run by
-- pg_cron for the coming week), then an officer edits it for that night only.
-- Bench raiders are left out of every fill, even when they are in a group:
-- Kat's rule (2026-09-18) is that a bench raider is out on every boss until an
-- officer puts them in for a fight or the whole night.
-- Until an officer saves a boss for the night (confirmed_at), that boss keeps
-- following its group, so a group edited on Tuesday reaches Thursday's plan.
-- Once saved, the night's plan is the record and stays as written.
--
-- Bosses are raid_encounters rows, not names. wcl-progression-sync upserts
-- every encounter of a zone from Warcraft Logs on every run, before any report
-- exists, and Season Settings' "Refresh from WCL" stamps each boss with its
-- Warcraft Logs id, so a boss listed there has a row within a sync. A renamed
-- raid or boss keeps its plan.
--
-- Who reads: the team's raiders (each sees their own bosses on the night page),
-- the team's officers and leader, guild officers and site admins. No public
-- read. Nobody writes the tables directly; every write goes through one of the
-- functions below, which take the same per-team lock so two officers saving at
-- once queue instead of interleaving, and which refuse a save made from a stale
-- page (the caller sends the list it last saw).

create table "public"."boss_groups" (
    "id" integer generated always as identity primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "encounter_id" integer not null references "public"."raid_encounters"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "created_at" timestamp with time zone not null default now(),
    unique ("team_id", "encounter_id", "player_id")
);

create index "boss_groups_encounter_id_idx" on "public"."boss_groups" ("encounter_id");
create index "boss_groups_player_id_idx" on "public"."boss_groups" ("player_id");

comment on table "public"."boss_groups" is
  'The standing group per boss for a team (#1216): one row per raider in the group that kills that boss. A new raid night is filled from these. Written only through set_boss_group().';

create table "public"."raid_night_bosses" (
    "id" integer generated always as identity primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "raid_date" date not null,
    "encounter_id" integer not null references "public"."raid_encounters"("id") on delete cascade,
    "position" integer not null,
    "skipped" boolean not null default false,
    "confirmed_at" timestamp with time zone,
    "confirmed_by" integer references "public"."people"("id") on delete set null,
    "created_at" timestamp with time zone not null default now(),
    unique ("team_id", "raid_date", "encounter_id")
);

create index "raid_night_bosses_encounter_id_idx" on "public"."raid_night_bosses" ("encounter_id");
create index "raid_night_bosses_confirmed_by_idx" on "public"."raid_night_bosses" ("confirmed_by");

comment on table "public"."raid_night_bosses" is
  'The bosses on one raid night''s list for a team (#1216), in pull order. skipped keeps a boss the team is not pulling that night on the list. confirmed_at and confirmed_by say an officer saved that boss''s lineup for the night; until then it follows the boss''s standing group. No rows for a night means it is not planned yet.';

comment on column "public"."raid_night_bosses"."confirmed_at" is
  'When an officer last saved this boss''s lineup for the night. Null while the lineup is the automatic copy of the standing group.';

create table "public"."raid_night_lineups" (
    "id" integer generated always as identity primary key,
    "team_id" integer not null,
    "raid_date" date not null,
    "encounter_id" integer not null,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "created_at" timestamp with time zone not null default now(),
    unique ("team_id", "raid_date", "encounter_id", "player_id"),
    foreign key ("team_id", "raid_date", "encounter_id")
      references "public"."raid_night_bosses" ("team_id", "raid_date", "encounter_id") on delete cascade
);

create index "raid_night_lineups_player_id_idx" on "public"."raid_night_lineups" ("player_id");

comment on table "public"."raid_night_lineups" is
  'The plan for one raid night (#1216): one row per raider in for one boss. Filled from boss_groups ahead of the night, then edited through set_raid_night_lineup(). Kept after the night, so it still says who was planned in.';

create trigger "trg_boss_groups_team_id_check"
  before insert or update on "public"."boss_groups"
  for each row execute function "public"."check_team_id_matches_player"();

create trigger "trg_raid_night_lineups_team_id_check"
  before insert or update on "public"."raid_night_lineups"
  for each row execute function "public"."check_team_id_matches_player"();

alter table "public"."boss_groups" owner to "postgres";
alter table "public"."raid_night_bosses" owner to "postgres";
alter table "public"."raid_night_lineups" owner to "postgres";
alter table "public"."boss_groups" enable row level security;
alter table "public"."raid_night_bosses" enable row level security;
alter table "public"."raid_night_lineups" enable row level security;

create policy "Claude readers read boss_groups" on "public"."boss_groups"
    for select to "claude_readers" using (true);
create policy "Officers read boss_groups" on "public"."boss_groups" for select
    using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
create policy "Team raiders read boss_groups" on "public"."boss_groups" for select
    using ((team_id IN (SELECT p.team_id FROM players p WHERE p.id = ANY ((SELECT my_active_player_ids())::integer[]))));

create policy "Claude readers read raid_night_bosses" on "public"."raid_night_bosses"
    for select to "claude_readers" using (true);
create policy "Officers read raid_night_bosses" on "public"."raid_night_bosses" for select
    using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
create policy "Team raiders read raid_night_bosses" on "public"."raid_night_bosses" for select
    using ((team_id IN (SELECT p.team_id FROM players p WHERE p.id = ANY ((SELECT my_active_player_ids())::integer[]))));

create policy "Claude readers read raid_night_lineups" on "public"."raid_night_lineups"
    for select to "claude_readers" using (true);
create policy "Officers read raid_night_lineups" on "public"."raid_night_lineups" for select
    using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
create policy "Team raiders read raid_night_lineups" on "public"."raid_night_lineups" for select
    using ((team_id IN (SELECT p.team_id FROM players p WHERE p.id = ANY ((SELECT my_active_player_ids())::integer[]))));

-- Checks a list of raiders sent by a page: no blanks, no repeats, and every
-- one an active (not archived) character on the team. Raises the message the
-- page shows. Internal: called only by the functions below.
create or replace function "public"."check_lineup_players"(p_team_id integer, p_player_ids integer[])
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_player_ids is null or array_position(p_player_ids, null) is not null then
    raise exception 'The lineup must be a list of raiders.';
  end if;

  if cardinality(p_player_ids) <> (select count(distinct x) from unnest(p_player_ids) x) then
    raise exception 'A raider is listed twice.';
  end if;

  if exists (
    select 1 from unnest(p_player_ids) x
    left join players p on p.id = x and p.team_id = p_team_id and p.archived_at is null
    where p.id is null
  ) then
    raise exception 'Every raider in the lineup must be on this team.';
  end if;
end;
$$;

alter function "public"."check_lineup_players"(integer, integer[]) owner to "postgres";
revoke all on function "public"."check_lineup_players"(integer, integer[]) from public, anon, authenticated;

-- Whether a list of raiders is the same set as another, in any order.
create or replace function "public"."same_player_set"(a integer[], b integer[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((select array_agg(distinct x order by x) from unnest(a) x), '{}')
       = coalesce((select array_agg(distinct x order by x) from unnest(b) x), '{}');
$$;

alter function "public"."same_player_set"(integer[], integer[]) owner to "postgres";
revoke all on function "public"."same_player_set"(integer[], integer[]) from public, anon, authenticated;

-- The raid night's date "today", as the team's schedule reads it. Raid times
-- are Eastern (raid_schedule.timezone's default and every row today).
create or replace function "public"."raid_today"()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'America/New_York')::date; $$;

alter function "public"."raid_today"() owner to "postgres";
revoke all on function "public"."raid_today"() from public, anon, authenticated;

-- Fills one raid night from the standing groups, if the night has no plan yet:
-- every boss of that night's season with a group goes on the list in pull
-- order, and each boss's lineup is its group minus archived and bench
-- raiders (a bench raider starts out and an officer puts them in). A night
-- that already has any boss row (planned, edited or all skipped) is left
-- alone. Returns how many bosses it put on the list. Internal: the cron job
-- and plan_raid_night() call it; nobody else can.
create or replace function "public"."fill_raid_night"(p_team_id integer, p_raid_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if exists (select 1 from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date) then
    return 0;
  end if;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position)
  select p_team_id, p_raid_date, e.id, row_number() over (order by z.sort_index, z.id, e.sort_index, e.id)
  from raid_encounters e
  join raid_zones z on z.id = e.zone_id
  join seasons s on s.display_name = z.season
  where p_raid_date between s.starts_at and coalesce(s.ends_at, 'infinity'::date)
    and exists (select 1 from boss_groups g where g.team_id = p_team_id and g.encounter_id = e.id);

  get diagnostics v_count = row_count;

  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, b.encounter_id, g.player_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date;

  return v_count;
end;
$$;

alter function "public"."fill_raid_night"(integer, date) owner to "postgres";
revoke all on function "public"."fill_raid_night"(integer, date) from public, anon, authenticated;

comment on function "public"."fill_raid_night"(integer, date) is
  'Fills a raid night''s boss list and lineups from the team''s standing groups (#1216), if the night has no plan yet. Internal: called by fill_upcoming_raid_nights() (pg_cron) and plan_raid_night().';

-- The cron job's body: fills every raid night in the coming week for every
-- team that has a standing group. Runs as the job owner, with no caller.
create or replace function "public"."fill_upcoming_raid_nights"()
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
  for v_team in select distinct team_id from boss_groups loop
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

alter function "public"."fill_upcoming_raid_nights"() owner to "postgres";
revoke all on function "public"."fill_upcoming_raid_nights"() from public, anon, authenticated;

comment on function "public"."fill_upcoming_raid_nights"() is
  'Fills the coming week''s raid nights from the standing groups for every team that has one (#1216). Run hourly by pg_cron. Returns how many bosses it put on nights'' lists.';

-- The standing group for one boss. p_expected_player_ids is the group the
-- page last read; a save made from a stale page is refused rather than
-- overwriting someone else's change. Null skips the check.
--
-- Nights in the coming days whose lineup for this boss nobody has saved yet
-- follow the new group, so the change reaches the next raid.
create or replace function "public"."set_boss_group"(
    "p_team_id" integer,
    "p_encounter_id" integer,
    "p_player_ids" integer[],
    "p_expected_player_ids" integer[] default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

alter function "public"."set_boss_group"(integer, integer, integer[], integer[]) owner to "postgres";

comment on function "public"."set_boss_group"(integer, integer, integer[], integer[]) is
  'Replaces a team''s standing group for one boss (#1216), for the team''s officers and leader, guild officers and site admins. Refuses archived raiders and other teams'' raiders, and refuses the save if the group changed since the caller read it (p_expected_player_ids; null skips that check). Coming nights nobody has saved for this boss follow the new group. Returns the group''s size.';

revoke all on function "public"."set_boss_group"(integer, integer, integer[], integer[]) from public, anon;
grant execute on function "public"."set_boss_group"(integer, integer, integer[], integer[]) to authenticated;

-- An officer filling a night by hand: the page's "Fill from the groups" for a
-- night the cron job has not reached yet. Leaves a planned night alone.
create or replace function "public"."plan_raid_night"(
    "p_team_id" integer,
    "p_raid_date" date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
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

  if not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  v_count := public.fill_raid_night(p_team_id, p_raid_date);

  if v_count > 0 then
    perform public.write_audit_log(
      p_team_id,
      'Plan Raid Night',
      'raid_night_bosses',
      null,
      jsonb_build_object('raid_date', p_raid_date, 'bosses', v_count)
    );
  end if;

  return v_count;
end;
$$;

alter function "public"."plan_raid_night"(integer, date) owner to "postgres";

comment on function "public"."plan_raid_night"(integer, date) is
  'Fills a raid night from the team''s standing groups (#1216) if it has no plan yet, for the team''s officers and leader, guild officers and site admins. Returns how many bosses it put on the night''s list; 0 when the night was already planned.';

revoke all on function "public"."plan_raid_night"(integer, date) from public, anon;
grant execute on function "public"."plan_raid_night"(integer, date) to authenticated;

-- One boss's lineup for one night: the page's "Save tonight". Adds the boss to
-- the night's list if it is not on it, and un-skips it if it was skipped.
-- p_expected_player_ids is the lineup the page last read, as for
-- set_boss_group(); null skips the check. Marks the boss confirmed, so it
-- stops following its group.
create or replace function "public"."set_raid_night_lineup"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_encounter_id" integer,
    "p_player_ids" integer[],
    "p_expected_player_ids" integer[] default null
) returns integer
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
  do update set skipped = false, confirmed_at = now(), confirmed_by = public.my_person_id();

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

alter function "public"."set_raid_night_lineup"(integer, date, integer, integer[], integer[]) owner to "postgres";

comment on function "public"."set_raid_night_lineup"(integer, date, integer, integer[], integer[]) is
  'Replaces one boss''s lineup for a raid night (#1216) and marks it confirmed, for the team''s officers and leader, guild officers and site admins. Adds or un-skips the boss on the night''s list. Refuses archived raiders, other teams'' raiders, a date that is not a raid night, and a save made after someone else changed that lineup (p_expected_player_ids; null skips that check). Returns the lineup''s size.';

revoke all on function "public"."set_raid_night_lineup"(integer, date, integer, integer[], integer[]) from public, anon;
grant execute on function "public"."set_raid_night_lineup"(integer, date, integer, integer[], integer[]) to authenticated;

-- "Not tonight": takes a boss off a night's plan, or puts it back. A skipped
-- boss stays on the list with no lineup. Putting it back refills it from its
-- group, unconfirmed.
create or replace function "public"."set_raid_night_boss_skipped"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_encounter_id" integer,
    "p_skipped" boolean
) returns void
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
     set skipped = p_skipped, confirmed_at = null, confirmed_by = null
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

alter function "public"."set_raid_night_boss_skipped"(integer, date, integer, boolean) owner to "postgres";

comment on function "public"."set_raid_night_boss_skipped"(integer, date, integer, boolean) is
  'Takes a boss off a raid night''s plan ("not tonight") or puts it back refilled from its standing group (#1216), for the team''s officers and leader, guild officers and site admins.';

revoke all on function "public"."set_raid_night_boss_skipped"(integer, date, integer, boolean) from public, anon;
grant execute on function "public"."set_raid_night_boss_skipped"(integer, date, integer, boolean) to authenticated;

-- Hourly, so a night is filled a week ahead and a raid added to the schedule
-- mid-week is filled within the hour. The job only ever fills empty nights.
do $$
begin
  perform cron.unschedule('fill-raid-night-lineups');
exception when others then
  null;
end $$;

select cron.schedule(
  'fill-raid-night-lineups',
  '5 * * * *',
  $cron$ select public.fill_upcoming_raid_nights(); $cron$
);
