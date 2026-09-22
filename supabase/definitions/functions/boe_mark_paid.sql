-- Function public.boe_mark_paid: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.boe_mark_paid(p_id integer, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_donated boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_team_id integer;
  v_item_name text;
  v_finder_name text;
  v_finder_payout bigint;
  v_had_intent boolean;
begin
  select b.status, b.team_id, b.item_name, b.finder_name, b.finder_payout, b.payout_donated
    into v_status, v_team_id, v_item_name, v_finder_name, v_finder_payout, v_had_intent
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not public.can_settle_boe(v_team_id) then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'sold' then
    raise exception 'Cannot mark a % BoE paid', v_status;
  end if;

  update public.boe_items
  set status = 'paid',
      payout_paid_at = coalesce(p_paid_at, now()),
      payout_donated = coalesce(p_donated, false)
  where id = p_id;

  if coalesce(p_donated, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'BoE Payout Donated', 'boe_items', p_id,
      to_jsonb(v_item_name || ': ' || public.format_boe_gold(coalesce(v_finder_payout, 0)) ||
        'g finder cut from ' || coalesce(v_finder_name, 'unknown finder') || ' kept by the guild'));
  else
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'BoE Payout Paid', 'boe_items', p_id,
      to_jsonb(v_item_name || ': ' || public.format_boe_gold(coalesce(v_finder_payout, 0)) ||
        'g to ' || coalesce(v_finder_name, 'unknown finder') ||
        (case when coalesce(v_had_intent, false) then ' (donate intent cleared)' else '' end)));
  end if;
end $function$;
