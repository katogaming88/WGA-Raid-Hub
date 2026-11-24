-- Function public.save_character_sim: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_character_sim(p_player_id integer, p_difficulty text, p_source text, p_report_id text, p_simmed_at timestamp with time zone, p_fight_style text, p_target_count integer, p_results jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_sim_id bigint;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select team_id into v_team_id from public.players
   where id = p_player_id and archived_at is null;
  if v_team_id is null
     or not (coalesce(public.is_own_player(p_player_id), false)
             or public.has_team_permission(v_team_id, 'manage_loot')
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if jsonb_typeof(p_results) is distinct from 'array'
     or jsonb_array_length(p_results) = 0 then
    raise exception 'The sim has no results.';
  end if;
  if jsonb_array_length(p_results) > 2000 then
    raise exception 'The sim has too many results.';
  end if;
  if p_simmed_at > now() + interval '1 day' then
    raise exception 'The sim''s date is in the future.';
  end if;

  insert into public.character_sims
    (team_id, player_id, difficulty, source, report_id, simmed_at, fight_style, target_count, added_by)
  values
    (v_team_id, p_player_id, p_difficulty, p_source, p_report_id, p_simmed_at,
     nullif(trim(p_fight_style), ''), p_target_count, public.my_person_id())
  on conflict (player_id, difficulty) do update
     set source = excluded.source,
         report_id = excluded.report_id,
         simmed_at = excluded.simmed_at,
         fight_style = excluded.fight_style,
         target_count = excluded.target_count,
         added_by = excluded.added_by,
         added_at = now()
  returning id into v_sim_id;

  delete from public.character_sim_results where sim_id = v_sim_id;

  insert into public.character_sim_results
    (sim_id, wow_item_id, item_name, slot, item_level, pct_gain, dps_gain, encounter_id, catalyst_from)
  select v_sim_id, r.wow_item_id, nullif(trim(r.item_name), ''), nullif(trim(r.slot), ''),
         r.item_level, r.pct_gain, r.dps_gain, r.encounter_id, r.catalyst_from
    from jsonb_to_recordset(p_results) as r(
           wow_item_id integer, item_name text, slot text, item_level integer,
           pct_gain numeric, dps_gain numeric, encounter_id integer, catalyst_from integer);
  get diagnostics v_count = row_count;

  -- Written here, not through write_audit_log(), which only officers may
  -- call; a raider adds their own sims (set_own_missing_spec() does the same).
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'Sim Added', 'players', p_player_id,
    jsonb_build_object('summary', initcap(p_difficulty) || ' sim from '
      || case p_source when 'raidbots' then 'Raidbots' else 'QE Live' end
      || ', ' || v_count || ' results'));
  return v_count;
end;
$function$;
