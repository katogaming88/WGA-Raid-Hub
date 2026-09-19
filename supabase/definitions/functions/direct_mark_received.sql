-- Function public.direct_mark_received: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.direct_mark_received(p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_request_id integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  select r.status into v_existing_status
  from public.self_received_requests r
  where r.player_id = v_player_id
    and r.self_item_id = v_item_id
    and r.slot is not distinct from nullif(p_slot, '')
    and r.track is not distinct from p_track
    and r.status in ('pending', 'approved')
  order by r.status
  limit 1;
  if v_existing_status = 'approved' then
    raise exception 'This item is already marked received for this character.';
  elsif v_existing_status = 'pending' then
    raise exception 'A report for this item is already waiting for review. Approve or reject that one instead of marking it again.';
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $function$;
