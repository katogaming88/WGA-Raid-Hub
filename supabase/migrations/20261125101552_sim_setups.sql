-- #1888 (part 1 of 2): sim setups. A team names its sim setups on Settings >
-- Loot > Sims (Single target, Several targets and so on), each a fight style,
-- number of targets and fight length with a weight, and the gain officers see
-- is the weighted average (Kat, 2026-10-18). So a raider keeps one sim per
-- setup: the key gains the fight style, targets and fight length, and a new
-- sim replaces only the one with the same three. The page matches a Raidbots
-- sim to a setup and turns away one that matches none; a QE Live sim has no
-- fight style, targets or length (all null) and counts as every setup (Kat,
-- 2026-11-25), so it stays one per character, difficulty and spec. The
-- settings themselves are keys in team_settings.config, saved by
-- set_team_setting() like the other loot settings; no table here.
--
-- Nulls count as equal in the key, so two QE Live sims for the same spec and
-- difficulty still replace each other. Sims saved before this have no fight
-- length; the page matches them to a setup on style and targets alone.

alter table public.character_sims
  add column fight_length integer check (fight_length between 1 and 3600);

comment on column public.character_sims.fight_length is
  'The fight length the sim was run at, in seconds (#1888); null for QE Live, and for sims saved before it was kept.';

alter table public.character_sims
  drop constraint character_sims_player_id_difficulty_spec_key,
  add constraint character_sims_player_setup_key
    unique nulls not distinct (player_id, difficulty, class_spec_id, fight_style, target_count, fight_length);

comment on table public.character_sims is
  'A raider''s latest droptimizer sim per difficulty, spec and setup (#1443, #1916, #1888): Raidbots or QE Live, written by save_character_sim().';

drop function public.save_character_sim(integer, text, integer, text, text, text, text, timestamp with time zone, text, integer, jsonb);
drop function public.delete_character_sim(integer, text, integer);

-- As #1916's, and now one per setup: p_fight_length is the fight length in
-- seconds (null for QE Live), and a sim replaces only the one with the same
-- fight style, targets and length.
create function public.save_character_sim(
  p_player_id integer,
  p_difficulty text,
  p_class_spec_id integer,
  p_source text,
  p_report_id text,
  p_character_name text,
  p_character_realm text,
  p_simmed_at timestamp with time zone,
  p_fight_style text,
  p_target_count integer,
  p_fight_length integer,
  p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_name_realm text;
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

  select p.team_id, coalesce(tm.role = 'team_leader', false), mine.class, p.name_realm
    into v_team_id, v_leader, v_class, v_name_realm
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

  -- A character with no roster spec has no class to check against, so it
  -- takes no sims until an officer sets one (CodeRabbit on PR #1920).
  if v_class is null then
    raise exception 'Set the character''s spec on the roster first.';
  end if;
  select cs.spec into v_spec
    from public.classes_specs cs
   where cs.id = p_class_spec_id and cs.class = v_class;
  if v_spec is null then
    raise exception 'The sim isn''t for this character''s class.';
  end if;

  -- name_realm is "Name-Realm"; the realm may itself hold a dash.
  if coalesce(regexp_replace(lower(p_character_name), '[[:space:]_''’-]', '', 'g'), '')
       is distinct from regexp_replace(lower(split_part(v_name_realm, '-', 1)), '[[:space:]_''’-]', '', 'g')
     or coalesce(regexp_replace(lower(p_character_realm), '[[:space:]_''’-]', '', 'g'), '') = ''
     or regexp_replace(lower(p_character_realm), '[[:space:]_''’-]', '', 'g')
       is distinct from regexp_replace(lower(substr(v_name_realm, strpos(v_name_realm, '-') + 1)), '[[:space:]_''’-]', '', 'g')
  then
    raise exception 'The sim is for another character.';
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
    (team_id, player_id, difficulty, class_spec_id, source, report_id, simmed_at, fight_style, target_count,
     fight_length, added_by)
  values
    (v_team_id, p_player_id, p_difficulty, p_class_spec_id, p_source, p_report_id, p_simmed_at,
     nullif(trim(p_fight_style), ''), p_target_count, p_fight_length, public.my_person_id())
  on conflict (player_id, difficulty, class_spec_id, fight_style, target_count, fight_length) do update
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
$$;

comment on function public.save_character_sim(integer, text, integer, text, text, text, text, timestamp with time zone, text, integer, integer, jsonb) is
  'Saves a raider''s sim at one difficulty, spec and setup, replacing the one there (#1443, #1916, #1888). The raider, an officer with manage_loot (not on the team leader''s character), or a site admin.';

-- Removes one sim, by its id: with a sim per setup, difficulty and spec no
-- longer name one. Same people as saving.
create function public.delete_character_sim(p_sim_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_team_id integer;
  v_leader boolean;
  v_own boolean;
  v_summary text;
  v_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select s.player_id, initcap(s.difficulty) || ' ' || cs.spec || ' sim removed'
         || coalesce(' (' || s.fight_style || ', ' || s.target_count
                     || case s.target_count when 1 then ' target)' else ' targets)' end, '')
    into v_player_id, v_summary
    from public.character_sims s
    join public.classes_specs cs on cs.id = s.class_spec_id
   where s.id = p_sim_id;
  -- Already gone (a second click on Remove): nothing to do.
  if v_player_id is null then
    return;
  end if;

  select p.team_id, coalesce(tm.role = 'team_leader', false) into v_team_id, v_leader
    from public.players p
    left join public.team_members tm on tm.id = p.team_member_id and tm.archived_at is null
   where p.id = v_player_id and p.archived_at is null;
  v_own := coalesce(public.is_own_player(v_player_id), false);
  if v_team_id is null
     or not (v_own
             or (public.has_team_permission(v_team_id, 'manage_loot') and not v_leader)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.character_sims where id = p_sim_id;
  -- Someone else removed it in the meantime: theirs is the one logged
  -- (CodeRabbit on PR #1921).
  if not found then
    return;
  end if;
  v_detail := jsonb_build_object('summary', v_summary);
  begin
    perform public.write_audit_log(v_team_id, 'Sim Removed', 'players', v_player_id, v_detail);
  exception when raise_exception then
    if not v_own then
      raise;
    end if;
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'Sim Removed', 'players', v_player_id, v_detail);
  end;
end;
$$;

comment on function public.delete_character_sim(bigint) is
  'Removes one of a raider''s sims by its id (#1443, #1916, #1888). The raider, an officer with manage_loot (not on the team leader''s character), or a site admin.';

revoke all on function public.save_character_sim(integer, text, integer, text, text, text, text, timestamp with time zone, text, integer, integer, jsonb) from public, anon;
revoke all on function public.delete_character_sim(bigint) from public, anon;
grant execute on function public.save_character_sim(integer, text, integer, text, text, text, text, timestamp with time zone, text, integer, integer, jsonb) to authenticated, service_role;
grant execute on function public.delete_character_sim(bigint) to authenticated, service_role;
