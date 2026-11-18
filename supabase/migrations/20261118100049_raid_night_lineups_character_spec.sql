-- #1580: a boss lineup and a usual group record which character and spec each raider plays.
--
-- Officers pick, boss by boss, another of a raider's characters (an alt from
-- their own Battle.net list, `characters`) or another spec of the class they
-- play (Kat's #1680 design: the swap button on every cell). Both lineup
-- tables from 20260918005412_boss_lineups.sql gain two columns:
--
--   character_id   the alt played; null = the raider's roster character
--   class_spec_id  the spec played; null = that character's usual spec
--
-- So every row already saved means what it meant before, and attendance and
-- loot keep reading player_id (the person on the roster), as #1580 says.
-- A pick saved for "every night after" goes on the usual group too (Kat,
-- 2026-10-27), so boss_groups carries the same two columns and every path
-- that copies a group onto a night copies them.
--
-- Teammates see an alt picked for their team's lineups by name (Kat,
-- 2026-11-18); until now a raider read only their own characters.

alter table public.raid_night_lineups
  add column character_id integer references public.characters (id) on delete set null,
  add column class_spec_id integer references public.classes_specs (id);

alter table public.boss_groups
  add column character_id integer references public.characters (id) on delete set null,
  add column class_spec_id integer references public.classes_specs (id);

comment on column public.raid_night_lineups.character_id is
  'The alt the raider plays on this boss (#1580); null = their roster character.';
comment on column public.raid_night_lineups.class_spec_id is
  'The spec the raider plays on this boss (#1580); null = the character''s usual spec.';
comment on column public.boss_groups.character_id is
  'The alt the raider usually plays on this boss (#1580); null = their roster character.';
comment on column public.boss_groups.class_spec_id is
  'The spec the raider usually plays on this boss (#1580); null = the character''s usual spec.';

create index raid_night_lineups_character_id_idx on public.raid_night_lineups (character_id)
  where character_id is not null;
create index boss_groups_character_id_idx on public.boss_groups (character_id)
  where character_id is not null;

-- A character someone takes off their Battle.net list, or that moves to
-- another person's list (save_battlenet_characters() keeps its id), takes its
-- picks with it: the raider goes back to their roster character in its usual
-- spec. The foreign key alone would clear character_id on a delete and leave
-- the alt's spec behind on the main.
--
-- Lock order, everywhere (CodeRabbit on PR #1874): a team's lineup lock
-- first, then any character. The saves, fills and putting a boss back all
-- take the lineup lock and then reference a character; the one function that
-- removes or moves characters, save_battlenet_characters() below, takes the
-- lineup lock of every team the change reaches before it touches a
-- character. The cleanup takes the same locks again in team order, which is
-- free when its caller already holds them.
create or replace function public.clear_lineup_picks_for_character() returns trigger
language plpgsql set search_path = public
as $$
declare
  v_team integer;
begin
  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id then
    return new;
  end if;

  for v_team in
    select team_id from raid_night_lineups where character_id = old.id
    union
    select team_id from boss_groups where character_id = old.id
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  update boss_groups set character_id = null, class_spec_id = null where character_id = old.id;
  update raid_night_lineups set character_id = null, class_spec_id = null where character_id = old.id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.clear_lineup_picks_for_character() from public, anon, authenticated;

create trigger characters_clear_lineup_picks
  before delete on public.characters
  for each row execute function public.clear_lineup_picks_for_character();

create trigger characters_clear_lineup_picks_on_new_owner
  after update of person_id on public.characters
  for each row execute function public.clear_lineup_picks_for_character();

-- A roster row that moves to another person (add_signup_to_roster(),
-- claim_character() and the joins set team_member_id) drops its alt picks:
-- the alt was the old person's (CodeRabbit on PR #1874). A spec pick on the
-- roster row's own class stays. Rows on the lineup tables only key-share the
-- players row, which this update doesn't conflict with, so taking the
-- lineup lock here keeps the order above.
create or replace function public.clear_lineup_alts_for_player() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.team_member_id is not distinct from old.team_member_id
     or not exists (select 1 from raid_night_lineups where player_id = new.id and character_id is not null
                    union all
                    select 1 from boss_groups where player_id = new.id and character_id is not null) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), new.team_id);
  update boss_groups set character_id = null, class_spec_id = null
   where player_id = new.id and character_id is not null;
  update raid_night_lineups set character_id = null, class_spec_id = null
   where player_id = new.id and character_id is not null;
  return new;
end;
$$;

revoke all on function public.clear_lineup_alts_for_player() from public, anon, authenticated;

create trigger players_clear_lineup_alts
  after update of team_member_id on public.players
  for each row execute function public.clear_lineup_alts_for_player();

-- The one writer of characters takes the lineup lock of every team its
-- change reaches (an alt it removes, or one it moves from another person)
-- before touching a character, so its cleanup never waits on a lineup lock
-- while holding a character a save or fill is waiting for. Otherwise as
-- 20260923211927_join_verifies_character.sql left it.
create or replace function public.save_battlenet_characters(p_person_id integer, p_characters jsonb)
returns setof characters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team integer;
begin
  if not exists (select 1 from people where id = p_person_id) then
    raise exception 'No person with id %', p_person_id;
  end if;

  for v_team in
    with listed as (
      select (x ->> 'blizzard_id')::bigint as blizzard_id
      from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
    ),
    touched as (
      select c.id from characters c
      where (c.person_id = p_person_id and c.blizzard_id not in (select blizzard_id from listed))
         or (c.person_id <> p_person_id and c.blizzard_id in (select blizzard_id from listed))
    )
    select l.team_id from raid_night_lineups l where l.character_id in (select id from touched)
    union
    select g.team_id from boss_groups g where g.character_id in (select id from touched)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  delete from characters c
   where c.person_id = p_person_id
     and c.blizzard_id not in (
       select (x ->> 'blizzard_id')::bigint from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
     );

  insert into characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
  select p_person_id,
         (x ->> 'blizzard_id')::bigint,
         x ->> 'name',
         x ->> 'realm',
         x ->> 'realm_slug',
         x ->> 'class_name',
         x ->> 'spec_name',
         (x ->> 'level')::integer,
         (x ->> 'item_level')::integer
    from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
  on conflict (blizzard_id) do update
    set person_id = excluded.person_id,
        name = excluded.name,
        realm = excluded.realm,
        realm_slug = excluded.realm_slug,
        class_name = excluded.class_name,
        spec_name = excluded.spec_name,
        level = excluded.level,
        item_level = excluded.item_level,
        saved_at = now();

  return query select * from characters where person_id = p_person_id order by name, realm;
end;
$$;

-- The picks a save sends, as stored: an object per raider whose character or
-- spec differs, {player_id, character_id, class_spec_id}. A pick naming the
-- raider's own roster character, or the character's usual spec, is stored as
-- null, so "the main in its usual spec" has one spelling and comparing a
-- night with its group stays exact.
create or replace function public.lineup_picks_norm(p_team_id integer, p_picks jsonb)
returns table (player_id integer, character_id integer, class_spec_id integer)
language sql stable set search_path = public
as $$
  select n.player_id, n.character_id, n.class_spec_id
  from (
    select x.player_id, a.character_id,
           case
             when x.class_spec_id is null then null
             when a.character_id is null and x.class_spec_id = p.class_spec_id then null
             when a.character_id is not null and x.class_spec_id = (
               select cs.id from classes_specs cs where cs.class = c.class_name and cs.spec = c.spec_name
             ) then null
             else x.class_spec_id
           end as class_spec_id
    from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
    join players p on p.id = x.player_id and p.team_id = p_team_id
    left join characters c on c.id = x.character_id
    cross join lateral (
      select case
               when c.id is null or c.name_realm_key = lower(replace(p.name_realm, ' ', '')) then null
               else c.id
             end as character_id
    ) a
  ) n
  where n.character_id is not null or n.class_spec_id is not null;
$$;

revoke all on function public.lineup_picks_norm(integer, jsonb) from public, anon, authenticated;

-- Every pick names someone in the lineup once, one of that raider's own
-- characters, and a spec that character's class has.
create or replace function public.check_lineup_picks(p_team_id integer, p_player_ids integer[], p_picks jsonb)
returns void
language plpgsql stable set search_path = public
as $$
begin
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then
    raise exception 'The picks must be a list.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_picks) as x(player_id integer)
    where x.player_id is null or not (x.player_id = any (p_player_ids))
  ) then
    raise exception 'A character or spec was picked for someone not in the lineup.';
  end if;

  if (select count(*) from jsonb_array_elements(p_picks))
     <> (select count(distinct x.player_id) from jsonb_to_recordset(p_picks) as x(player_id integer)) then
    raise exception 'A raider has two picks for one boss.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_picks) as x(player_id integer, character_id integer)
    where x.character_id is not null
      and not exists (
        select 1
        from players p
        join team_members tm on tm.id = p.team_member_id
        join characters c on c.person_id = tm.person_id
        where p.id = x.player_id and p.team_id = p_team_id and c.id = x.character_id
      )
  ) then
    raise exception 'That character isn''t one of the raider''s own.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_picks) as x(player_id integer, character_id integer, class_spec_id integer)
    join players p on p.id = x.player_id and p.team_id = p_team_id
    left join classes_specs main on main.id = p.class_spec_id
    left join characters c on c.id = x.character_id
    where x.class_spec_id is not null
      and not exists (
        -- The class of the row it is stored on: a character with the
        -- roster row's own name is stored as the roster row
        -- (lineup_picks_norm()), so its spec must be one of the roster
        -- class's (CodeRabbit on PR #1874).
        select 1 from classes_specs cs
        where cs.id = x.class_spec_id
          and cs.class = case
                when c.id is null or c.name_realm_key = lower(replace(p.name_realm, ' ', '')) then main.class
                else c.class_name
              end
      )
  ) then
    raise exception 'That spec isn''t one the character''s class has.';
  end if;
end;
$$;

revoke all on function public.check_lineup_picks(integer, integer[], jsonb) from public, anon, authenticated;

-- Two lists of picks, as stored, are the same set.
create or replace function public.same_lineup_picks(a jsonb, b jsonb) returns boolean
language sql immutable set search_path = public
as $$
  select coalesce((
           select jsonb_agg(jsonb_build_array(x.player_id, x.character_id, x.class_spec_id)
                            order by x.player_id, x.character_id, x.class_spec_id)
           from jsonb_to_recordset(coalesce(a, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
         ), '[]'::jsonb)
       = coalesce((
           select jsonb_agg(jsonb_build_array(x.player_id, x.character_id, x.class_spec_id)
                            order by x.player_id, x.character_id, x.class_spec_id)
           from jsonb_to_recordset(coalesce(b, '[]'::jsonb)) as x(player_id integer, character_id integer, class_spec_id integer)
         ), '[]'::jsonb);
$$;

revoke all on function public.same_lineup_picks(jsonb, jsonb) from public, anon, authenticated;

-- A night's lineup for one boss, now with picks. The old five-argument
-- version goes: the new app is its only caller and ships with this.
drop function public.set_raid_night_lineup(integer, date, integer, integer[], integer[]);

create function public.set_raid_night_lineup(
  p_team_id integer,
  p_raid_date date,
  p_encounter_id integer,
  p_player_ids integer[],
  p_expected_player_ids integer[] default null,
  p_picks jsonb default null,
  p_expected_picks jsonb default null
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

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  -- The picked alts stay put until this save is done (taken after the lineup
  -- lock, the order everything here takes them in), and one already gone
  -- asks for a reload: someone changed the characters since it was opened.
  perform 1 from characters
  where id in (
    select x.character_id from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(character_id integer)
  )
  for share;
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
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if (p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids))
     or (p_expected_picks is not null and not public.same_lineup_picks(v_current_picks, p_expected_picks))
     or (p_picks is null and v_current_picks <> '[]'::jsonb) then
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
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id, character_id, class_spec_id)
  select p_team_id, p_raid_date, p_encounter_id, x, n.character_id, n.class_spec_id
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
      'player_ids', to_jsonb(p_player_ids),
      'was', to_jsonb(v_current),
      'picks', coalesce(p_picks, '[]'::jsonb),
      'picks_were', v_current_picks
    )
  );

  return cardinality(p_player_ids);
end;
$$;

revoke all on function public.set_raid_night_lineup(integer, date, integer, integer[], integer[], jsonb, jsonb) from public, anon;
grant execute on function public.set_raid_night_lineup(integer, date, integer, integer[], integer[], jsonb, jsonb) to authenticated;

-- A boss's usual group, now with picks; coming nights nobody has saved
-- follow it, picks and all.
drop function public.set_boss_group(integer, integer, integer[], integer[]);

create function public.set_boss_group(
  p_team_id integer,
  p_encounter_id integer,
  p_player_ids integer[],
  p_expected_player_ids integer[] default null,
  p_picks jsonb default null,
  p_expected_picks jsonb default null
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

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  -- The picked alts stay put until this save is done (taken after the lineup
  -- lock, the order everything here takes them in), and one already gone
  -- asks for a reload: someone changed the characters since it was opened.
  perform 1 from characters
  where id in (
    select x.character_id from jsonb_to_recordset(coalesce(p_picks, '[]'::jsonb)) as x(character_id integer)
  )
  for share;
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
$$;

revoke all on function public.set_boss_group(integer, integer, integer[], integer[], jsonb, jsonb) from public, anon;
grant execute on function public.set_boss_group(integer, integer, integer[], integer[], jsonb, jsonb) to authenticated;

-- Filling a night from the groups carries each raider's pick.
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

  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id, character_id, class_spec_id)
  select p_team_id, p_raid_date, b.encounter_id, g.player_id, g.character_id, g.class_spec_id
  from raid_night_bosses b
  join boss_groups g on g.team_id = b.team_id and g.encounter_id = b.encounter_id
  join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
  where b.team_id = p_team_id and b.raid_date = p_raid_date and not b.skipped;

  perform log_killed_boss_skips(array(
    select id from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and skipped_for_kill_id is not null));

  return v_count;
end;
$$;

-- Putting a skipped boss back fills it from its group, picks and all.
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
    public.has_team_permission(p_team_id, 'edit_schedule')
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
    insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id, character_id, class_spec_id)
    select p_team_id, p_raid_date, p_encounter_id, g.player_id, g.character_id, g.class_spec_id
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

-- A raider reads the alts picked in their own team's lineups and groups, and
-- no other. The rest of the characters rules stand: officers read their
-- teams' characters, and everyone reads their own.
create policy "Team raiders read characters picked in their team's lineups" on public.characters
  for select
  using (
    id in (
      select l.character_id from raid_night_lineups l
      where l.character_id is not null
        and l.team_id in (
          select p.team_id from players p
          where p.id = any ((select public.my_active_player_ids())::integer[])
        )
      union
      select g.character_id from boss_groups g
      where g.character_id is not null
        and g.team_id in (
          select p.team_id from players p
          where p.id = any ((select public.my_active_player_ids())::integer[])
        )
    )
  );
