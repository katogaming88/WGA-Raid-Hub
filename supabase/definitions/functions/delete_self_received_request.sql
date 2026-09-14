-- Function public.delete_self_received_request: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.delete_self_received_request(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_player_id integer;
  v_item_id integer;
  v_status text;
  v_track text;
  v_source text;
  v_slot text;
  v_player_name text;
  v_item_name text;
begin
  select r.team_id, r.player_id, r.self_item_id, r.status, r.track, r.source, r.slot
    into v_team_id, v_player_id, v_item_id, v_status, v_track, v_source, v_slot
  from public.self_received_requests r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'Self-received request not found';
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false)
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.name_realm into v_player_name from public.players p where p.id = v_player_id;
  select i.name into v_item_name from public.items i where i.id = v_item_id;

  delete from public.self_received_requests where id = p_id;

  perform public.write_audit_log(
    v_team_id,
    'Self-Received Deleted',
    'players',
    v_player_id,
    to_jsonb(
      'Deleted ' || v_status || ' request: ' || coalesce(v_item_name, 'unknown item')
      || coalesce(' (' || nullif(v_slot, '') || ')', '')
      || coalesce(', ' || v_track, '')
      || coalesce(', ' || v_source, '')
      || case when v_player_id is null or v_player_name is null
              then ', player no longer on roster' else '' end
    )
  );
end $function$;
