-- #1679: officers set the order a team pulls its bosses in.
--
-- Each night's plan already keeps a pull order (raid_night_bosses.position),
-- filled once in the game's order and never changed. Now an officer moves
-- bosses on Boss Lineup (Kat's #1680 design, board D), and the save asks, as
-- the lineup's does: just that night, or that night and every night after.
--
-- "Every night after" needs a team order to fill later nights from, which
-- nothing held: team_boss_order, one row per team and boss. It also
-- reorders every coming night already filled, including one whose order was
-- set by hand for that night alone (Kat, 2026-11-18: "every night after"
-- means every one). A boss with no row in the team order (a new season's)
-- fills after the ordered ones, in the game's order, as before.

create table public.team_boss_order (
  team_id integer not null references public.teams (id) on delete cascade,
  encounter_id integer not null references public.raid_encounters (id) on delete cascade,
  position integer not null check (position > 0),
  updated_at timestamp with time zone not null default now(),
  primary key (team_id, encounter_id)
);

comment on table public.team_boss_order is
  'The order a team pulls its bosses in (#1679), saved from Boss Lineup with "every night after". New raid nights fill in this order; a boss with no row fills after, in the game''s order. Written and read only by the lineup functions.';

create index team_boss_order_encounter_id_idx on public.team_boss_order (encounter_id);

alter table public.team_boss_order owner to postgres;
alter table public.team_boss_order enable row level security;

create policy "Claude readers read team_boss_order" on public.team_boss_order
  for select to claude_readers using (true);

-- Nobody reads or writes it from the site: each night's order is on
-- raid_night_bosses, which the team already reads.
revoke all on table public.team_boss_order from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.team_boss_order to service_role;

-- One night's pull order: every boss on the night, in its new order. With
-- p_every_night it becomes the team's order, and every coming night already
-- filled is put in that order too.
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

  select coalesce(array_agg(encounter_id order by position, encounter_id), '{}') into v_current
  from raid_night_bosses
  where team_id = p_team_id and raid_date = p_raid_date;

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

    -- Every coming night already filled, in the team's order; a boss the
    -- team order doesn't list keeps its place after the ones it does.
    update raid_night_bosses b
       set position = r.ord
      from (
        select n.id,
               row_number() over (partition by n.raid_date order by o.position nulls last, n.position, n.encounter_id) as ord
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

alter function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean) owner to postgres;

comment on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean) is
  'Boss Lineup (#1679): one raid night''s pull order, every boss on it listed once. Refused when the night''s order changed since p_expected_ids was read. With p_every_night it also becomes the team''s order (team_boss_order) and every coming night already filled follows it. edit_schedule or site admin.';

revoke all on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean) from public, anon;
grant execute on function public.set_raid_night_boss_order(integer, date, integer[], integer[], boolean) to authenticated;

-- New nights fill in the team's order (only the order by changes).
CREATE OR REPLACE FUNCTION public.fill_raid_night(p_team_id integer, p_raid_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
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

  select i.difficulty into v_difficulty from raid_night_info(p_team_id, p_raid_date) i;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position, skipped, skipped_for_kill_id)
  select p_team_id, p_raid_date, e.id,
         row_number() over (order by o.position nulls last, z.sort_index, z.id, e.sort_index, e.id),
         k.id is not null, k.id
  from raid_encounters e
  join raid_zones z on z.id = e.zone_id
  left join team_boss_order o on o.team_id = p_team_id and o.encounter_id = e.id
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
$function$;
