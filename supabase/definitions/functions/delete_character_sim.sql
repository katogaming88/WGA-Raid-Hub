-- Function public.delete_character_sim: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.delete_character_sim(p_sim_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         || public.sim_setup_label(s.fight_style, s.target_count, s.fight_length)
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
$function$;
