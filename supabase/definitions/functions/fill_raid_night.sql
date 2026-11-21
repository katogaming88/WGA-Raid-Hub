-- Function public.fill_raid_night: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.fill_raid_night(p_team_id integer, p_raid_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
