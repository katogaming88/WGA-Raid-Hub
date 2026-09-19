-- Function public.submit_self_received: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.submit_self_received(p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text)
 RETURNS TABLE(id integer, auto_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_track_label text := case p_track
    when 'Myth' then ' at Mythic' when 'Hero' then ' at Heroic' when 'Champion' then ' on the Champion track'
    else '' end;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(p_source, '') = 'Other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say where the item came from in the note. An officer reviews Other reports.';
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
    raise exception 'This item is already marked received% for this character.', v_track_label;
  elsif v_existing_status = 'pending' then
    raise exception 'You already reported this item%. It is waiting for an officer to review it.', v_track_label;
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.person_id = public.my_person_id();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $function$;
