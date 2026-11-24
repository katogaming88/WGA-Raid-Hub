-- Function public.delete_character_sim: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.delete_character_sim(p_player_id integer, p_difficulty text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_leader boolean;
  v_own boolean;
  v_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select p.team_id, coalesce(tm.role = 'team_leader', false) into v_team_id, v_leader
    from public.players p
    left join public.team_members tm on tm.id = p.team_member_id and tm.archived_at is null
   where p.id = p_player_id;
  v_own := coalesce(public.is_own_player(p_player_id), false);
  if v_team_id is null
     or not (v_own
             or (public.has_team_permission(v_team_id, 'manage_loot') and not v_leader)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.character_sims where player_id = p_player_id and difficulty = p_difficulty;
  if found then
    v_detail := jsonb_build_object('summary', initcap(p_difficulty) || ' sim removed');
    if v_own then
      insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
      values (v_team_id, auth.uid(), 'Sim Removed', 'players', p_player_id, v_detail);
    else
      perform public.write_audit_log(v_team_id, 'Sim Removed', 'players', p_player_id, v_detail);
    end if;
  end if;
end;
$function$;
