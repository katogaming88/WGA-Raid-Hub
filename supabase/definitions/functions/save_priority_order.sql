-- Function public.save_priority_order: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_priority_order(p_team_id integer, p_season text, p_item_id integer, p_track text, p_player_ids jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item_name text;
  v_count integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and item_id = p_item_id
     and track = p_track;

  insert into public.priority_order (team_id, season, item_id, track, rank, player_id, updated_at)
  select p_team_id, p_season, p_item_id, p_track, ord::integer, (elem)::integer, now()
  from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) with ordinality as t(elem, ord);

  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.priority_order_confirmed_empty (team_id, season, item_id, track, marked_at)
    values (p_team_id, p_season, p_item_id, p_track, now())
    on conflict (team_id, season, item_id, track) do update set marked_at = excluded.marked_at;
  else
    delete from public.priority_order_confirmed_empty
     where team_id = p_team_id
       and season = p_season
       and item_id = p_item_id
       and track = p_track;
  end if;

  select name into v_item_name from public.items where id = p_item_id;

  perform public.write_audit_log(
    p_team_id,
    'Priority Order Saved',
    'items',
    p_item_id,
    jsonb_build_object('item', v_item_name, 'track', p_track, 'players', v_count)
  );

  return v_count;
end;
$function$;
