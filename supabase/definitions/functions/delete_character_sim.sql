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
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null
     or not (coalesce(public.is_own_player(p_player_id), false)
             or public.has_team_permission(v_team_id, 'manage_loot')
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.character_sims where player_id = p_player_id and difficulty = p_difficulty;
  if found then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'Sim Removed', 'players', p_player_id,
      jsonb_build_object('summary', initcap(p_difficulty) || ' sim removed'));
  end if;
end;
$function$;
