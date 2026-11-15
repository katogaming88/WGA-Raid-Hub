-- Function public.season_vault: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.season_vault(p_season text, p_raid_kills jsonb, p_mplus_runs jsonb, p_delves jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with offers as (
    select 'raid' as vault_row, w.track, w.rank
      from jsonb_to_recordset(coalesce(p_raid_kills, '[]')) k(encounter_id integer, instance_id integer, difficulty text)
      join season_vault_raids r on r.season = p_season and r.instance_id = k.instance_id
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'raid' and w.difficulty = k.difficulty
           and (w.encounter_id is null or w.encounter_id = k.encounter_id)
         order by w.encounter_id nulls last
         limit 1) w
    union all
    select 'dungeon', w.track, w.rank
      from jsonb_to_recordset(coalesce(p_mplus_runs, '[]')) m(level integer)
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'dungeon' and w.from_level <= m.level
         order by w.from_level desc
         limit 1) w
    union all
    select 'world', w.track, w.rank
      from jsonb_each_text(coalesce(p_delves, '{}')) d(tier, n)
      cross join generate_series(1, greatest(d.n::integer, 0))
      cross join lateral (
        select w.track, w.rank from season_vault_rewards w
         where w.season = p_season and w.vault_row = 'world' and w.from_level <= d.tier::integer
         order by w.from_level desc
         limit 1) w
  ),
  ranked as (
    select o.vault_row, o.track, o.rank, t.item_level,
           row_number() over (partition by o.vault_row order by t.item_level desc, o.rank desc) as pos,
           count(*) over (partition by o.vault_row) as done
      from offers o
      join season_track_steps t on t.season = p_season and t.track = o.track and t.rank = o.rank
  ),
  slots as (
    select s.vault_row, s.slot,
           jsonb_build_object('needs', s.needs, 'done', coalesce(d.done, 0))
           || case when r.pos is not null
                   then jsonb_build_object('track', r.track, 'rank', r.rank, 'item_level', r.item_level)
                   else jsonb_build_object('left', s.needs - coalesce(d.done, 0)) end as slot_json
      from season_vault_slots s
      left join (select distinct vault_row, done from ranked) d on d.vault_row = s.vault_row
      left join ranked r on r.vault_row = s.vault_row and r.pos = s.needs
     where s.season = p_season
  )
  select coalesce(jsonb_object_agg(vault_row, case when vault_row = 'world' and p_delves is null then null else list end), '{}')
    from (select vault_row, jsonb_agg(slot_json order by slot) as list from slots group by vault_row) g;
$function$;
