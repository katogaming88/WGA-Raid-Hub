-- Function public.boe_edit_item: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.boe_edit_item(p_id integer, p_item_name text, p_track text, p_note text, p_item_id integer, p_upgrade_rank text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_old_item_name text;
  v_old_track text;
  v_old_note text;
  v_old_item_id integer;
  v_old_upgrade_rank text;
  v_detail text := '';
begin
  select b.team_id, b.item_name, b.track, b.note, b.item_id, b.upgrade_rank
    into v_team_id, v_old_item_name, v_old_track, v_old_note, v_old_item_id, v_old_upgrade_rank
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_old_item_name is distinct from p_item_name then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'item renamed from ' || coalesce('"' || v_old_item_name || '"', '(none)')
      || ' to ' || coalesce('"' || p_item_name || '"', '(none)');
  end if;
  if v_old_track is distinct from p_track then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'track was ' || coalesce('"' || v_old_track || '"', '(none)')
      || ', now ' || coalesce('"' || p_track || '"', '(none)');
  end if;
  if v_old_note is distinct from p_note then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'note was ' || coalesce('"' || v_old_note || '"', '(none)')
      || ', now ' || coalesce('"' || p_note || '"', '(none)');
  end if;
  if v_old_item_id is distinct from p_item_id then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'catalog link was ' || coalesce(v_old_item_id::text, '(none)')
      || ', now ' || coalesce(p_item_id::text, '(none)');
  end if;
  if v_old_upgrade_rank is distinct from p_upgrade_rank then
    v_detail := v_detail || (case when v_detail = '' then '' else '; ' end)
      || 'rank was ' || coalesce('"' || v_old_upgrade_rank || '"', '(none)')
      || ', now ' || coalesce('"' || p_upgrade_rank || '"', '(none)');
  end if;

  update public.boe_items
  set item_name = p_item_name, track = p_track, note = p_note,
      item_id = p_item_id, upgrade_rank = p_upgrade_rank
  where id = p_id;

  if v_detail <> '' then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'BoE Find Edited', 'boe_items', p_id, to_jsonb(v_detail));
  end if;
end $function$;
