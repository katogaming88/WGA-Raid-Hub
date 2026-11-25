-- Function public.save_character_sim: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_character_sim(p_player_id integer, p_difficulty text, p_class_spec_id integer, p_source text, p_report_id text, p_simmed_at timestamp with time zone, p_fight_style text, p_target_count integer, p_results jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_class text;
  v_spec text;
  v_sim_id bigint;
  v_count integer;
  v_leader boolean;
  v_own boolean;
  v_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select p.team_id, coalesce(tm.role = 'team_leader', false), mine.class
    into v_team_id, v_leader, v_class
    from public.players p
    left join public.team_members tm on tm.id = p.team_member_id and tm.archived_at is null
    left join public.classes_specs mine on mine.id = p.class_spec_id
   where p.id = p_player_id and p.archived_at is null;
  v_own := coalesce(public.is_own_player(p_player_id), false);
  if v_team_id is null
     or not (v_own
             or (public.has_team_permission(v_team_id, 'manage_loot') and not v_leader)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select cs.spec into v_spec
    from public.classes_specs cs
   where cs.id = p_class_spec_id and (v_class is null or cs.class = v_class);
  if v_spec is null then
    raise exception 'The sim isn''t for this character''s class.';
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
    (team_id, player_id, difficulty, class_spec_id, source, report_id, simmed_at, fight_style, target_count, added_by)
  values
    (v_team_id, p_player_id, p_difficulty, p_class_spec_id, p_source, p_report_id, p_simmed_at,
     nullif(trim(p_fight_style), ''), p_target_count, public.my_person_id())
  on conflict (player_id, difficulty, class_spec_id) do update
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

  v_detail := jsonb_build_object('summary', initcap(p_difficulty) || ' ' || v_spec || ' sim from '
    || case p_source when 'raidbots' then 'Raidbots' else 'QE Live' end
    || ', ' || v_count || ' results');
  -- write_audit_log() for everyone it accepts; it raises for a raider with
  -- no officer permission, whose own change is then logged directly.
  begin
    perform public.write_audit_log(v_team_id, 'Sim Added', 'players', p_player_id, v_detail);
  exception when raise_exception then
    if not v_own then
      raise;
    end if;
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'Sim Added', 'players', p_player_id, v_detail);
  end;
  return v_count;
end;
$function$;
