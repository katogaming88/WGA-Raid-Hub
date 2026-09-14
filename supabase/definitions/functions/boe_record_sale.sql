-- Function public.boe_record_sale: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.boe_record_sale(p_id integer, p_sale_price bigint, p_sold_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(sale_price bigint, finder_payout bigint, guild_cut bigint, ah_fee bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- The game's fixed auction house cut (#861), verified against two real
  -- mails. Not a setting: nothing reads it but this function and the
  -- backfill that introduced the column.
  c_ah_fee_pct constant numeric := 5;
  v_status text;
  v_floor bigint;
  v_pivot bigint;
  v_fee bigint;
  v_payout bigint;
begin
  select b.status into v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot record a sale on a % BoE', v_status;
  end if;
  if p_sale_price is null or p_sale_price <= 0 then
    raise exception 'Sale price must be positive';
  end if;

  select s.boe_payout_floor, s.boe_payout_pivot into v_floor, v_pivot
  from public.site_settings s where s.id = 1;

  -- Whole gold, half away from zero: silver and copper are ignored by
  -- decision (a 47,999 sale carries a 2,399g 95s cut in game and 2,400 here),
  -- the same rounding the payout uses.
  v_fee := round(p_sale_price::numeric * c_ah_fee_pct / 100)::bigint;

  -- Guild policy (#745 comment): 20%-of-gross or the floor, whichever is
  -- larger, rounded to the nearest gold half away from zero, and never more
  -- than the sale net of the fee (#861), so the guild is never out of pocket
  -- on a sub-floor sale. The guild keeps what is left after the fee.
  v_payout := least(p_sale_price - v_fee, greatest(v_floor, round(p_sale_price::numeric * v_floor / v_pivot)))::bigint;

  update public.boe_items b
  set status = 'sold',
      sold_at = coalesce(p_sold_at, now()),
      sale_price = p_sale_price,
      finder_payout = v_payout,
      guild_cut = p_sale_price - v_fee - v_payout,
      ah_fee = v_fee,
      payout_floor = v_floor,
      payout_pivot = v_pivot
  where b.id = p_id;

  return query select p_sale_price, v_payout, p_sale_price - v_fee - v_payout, v_fee;
end $function$;
