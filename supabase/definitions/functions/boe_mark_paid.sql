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
begin
  select b.status, b.team_id into v_status, v_team_id
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
end $function$;
