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
$function$;
