-- #1593: a BoE can be sold to a guild member instead of on the auction house.
--
-- Guild policy lets a raider buy a BoE from the guild for 60% of what it would
-- sell for on the auction house, and the finder still gets their cut. Until
-- now boe_record_sale knew only auction house sales, so a sale like that went
-- in as an auction house sale: a fee nobody paid and the wrong split.
--
-- Decided on #1593 (2026-10-21): the finder's cut is figured on the auction
-- house price, the cut an auction house sale would have paid, and is still
-- never more than what came in, so the guild bank takes the whole discount.
-- The rate is a site setting beside the payout floor and pivot, and each
-- guild member sale copies it, the way a sold row copies the floor and pivot.
-- The officer enters the auction house price and the buyer, and the hub
-- figures what they pay: the rate of that price, rounded down to the nearest
-- 1,000g, the guild taking the rounding along with the discount. A constraint
-- holds every guild member row to that figure.
--
-- Order: the setting and its setter; the columns; a backfill naming every
-- existing sold or paid row an auction house sale; then the constraints,
-- which require the channel on exactly those rows. The backfill runs as
-- postgres, and check_boe_status_transition returns early for any role but
-- authenticated, so no trigger bypass is needed. Every new column is outside
-- that trigger's metadata list, so a plain UPDATE can never write one.

alter table public.site_settings
  add column boe_member_rate_pct integer not null default 60;

alter table public.site_settings
  add constraint site_settings_boe_member_rate_pct_range check (boe_member_rate_pct between 1 and 100);

comment on column public.site_settings.boe_member_rate_pct is
  'What a guild member pays for a BoE bought from the guild, as a whole percent of its auction house price, rounded down to the nearest 1,000g (#1593). boe_record_sale applies it and copies it onto each guild member sale.';

-- The rate joins the setter as an optional third argument. Left out, the rate
-- stays as it is, so the admin page keeps working before it has a field for
-- it. A new argument is a new signature, so the two-argument function is
-- dropped in the same file; leaving it would give PostgREST two candidates.
drop function public.set_boe_payout_settings(bigint, bigint);

create function public.set_boe_payout_settings(
  p_floor bigint,
  p_pivot bigint,
  p_member_rate_pct integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  if p_floor is null or p_floor < 0 then
    raise exception 'Payout floor must be zero or more';
  end if;
  if p_pivot is null or p_pivot <= 0 then
    raise exception 'Payout pivot must be positive';
  end if;
  if p_member_rate_pct is not null and (p_member_rate_pct < 1 or p_member_rate_pct > 100) then
    raise exception 'Guild member rate must be between 1 and 100';
  end if;

  update public.site_settings
  set boe_payout_floor = p_floor,
      boe_payout_pivot = p_pivot,
      boe_member_rate_pct = coalesce(p_member_rate_pct, boe_member_rate_pct),
      updated_at = now()
  where id = 1
  returning boe_member_rate_pct into v_rate;

  perform public.write_audit_log(
    null,
    'boe_payout_settings_updated',
    'site_settings',
    null,
    jsonb_build_object('floor', p_floor, 'pivot', p_pivot, 'member_rate_pct', v_rate)
  );
end $$;

revoke all on function public.set_boe_payout_settings(bigint, bigint, integer) from public;
revoke execute on function public.set_boe_payout_settings(bigint, bigint, integer) from anon;
grant execute on function public.set_boe_payout_settings(bigint, bigint, integer) to authenticated;

alter table public.boe_items
  add column sale_channel text,
  add column ah_price bigint,
  add column buyer_name text,
  add column member_rate_pct integer;

comment on column public.boe_items.sale_price is
  'What the buyer paid, whole gold: the auction house sale price, or on a guild member sale member_rate_pct of ah_price rounded down to the nearest 1,000g (#1593). Present iff sold/paid.';
comment on column public.boe_items.ah_fee is
  'The auction house fee the game kept on the sale, whole gold: round(sale_price * 5 / 100), half away from zero (#861), and 0 on a guild member sale, which never went through the auction house (#1593). Present iff sold/paid; finder_payout + guild_cut + ah_fee = sale_price by constraint.';
comment on column public.boe_items.sale_channel is
  'Who bought it: auction_house, or guild_member when a raider bought it from the guild (#1593). Present iff sold/paid.';
comment on column public.boe_items.ah_price is
  'On a guild member sale, what the item would have sold for on the auction house, as the officer entered it; what they paid and the finder''s cut are figured from it (#1593). Null otherwise.';
comment on column public.boe_items.buyer_name is
  'On a guild member sale, who bought it, as the officer typed it with each run of whitespace folded to one space and the ends trimmed, at most 100 characters (#1593). Null otherwise.';
comment on column public.boe_items.member_rate_pct is
  'On a guild member sale, the site''s rate (site_settings.boe_member_rate_pct) when it was recorded (#1593). Null otherwise.';

-- Every sale before this migration went through the auction house, the one
-- route there was. Guarded so a second run is a no-op.
do $$
declare
  v_count integer;
begin
  update public.boe_items
  set sale_channel = 'auction_house'
  where status in ('sold', 'paid') and sale_channel is null;
  get diagnostics v_count = row_count;
  raise notice 'boe_items: % sold or paid rows named auction house sales', v_count;
end $$;

alter table public.boe_items add constraint boe_items_sale_channel_check
  check (sale_channel in ('auction_house', 'guild_member'));
alter table public.boe_items add constraint boe_items_ah_price_positive check (ah_price > 0);
alter table public.boe_items add constraint boe_items_buyer_name_shape
  check (buyer_name = btrim(regexp_replace(buyer_name, '\s+', ' ', 'g'))
         and buyer_name <> '' and char_length(buyer_name) <= 100);
alter table public.boe_items add constraint boe_items_member_rate_range check (member_rate_pct between 1 and 100);

alter table public.boe_items drop constraint boe_items_money_only_when_sold;
alter table public.boe_items add constraint boe_items_money_only_when_sold check (
  status in ('sold', 'paid')
  or (sale_price is null and finder_payout is null and guild_cut is null and ah_fee is null
      and payout_floor is null and payout_pivot is null
      and sale_channel is null and ah_price is null and buyer_name is null and member_rate_pct is null)
);

alter table public.boe_items drop constraint boe_items_money_complete_when_sold;
alter table public.boe_items add constraint boe_items_money_complete_when_sold check (
  status not in ('sold', 'paid')
  or (sale_price is not null and finder_payout is not null and guild_cut is not null and ah_fee is not null
      and payout_floor is not null and payout_pivot is not null and sale_channel is not null)
);

-- A guild member sale carries the auction house price, the buyer and the
-- rate, takes no fee, and the price paid is the rate of the auction house
-- price rounded down to the nearest 1,000g, in whole-number arithmetic as
-- boe_record_sale figures it. An auction house sale carries none of the
-- three. A zero fee alone does not mark a guild member sale: an auction house
-- sale under 10 gold rounds to one.
alter table public.boe_items add constraint boe_items_member_sale_shape check (
  sale_channel is distinct from 'guild_member'
  or (ah_price is not null and buyer_name is not null and member_rate_pct is not null
      and ah_fee = 0 and sale_price = ah_price * member_rate_pct / 100000 * 1000)
);
alter table public.boe_items add constraint boe_items_member_cols_only_for_member check (
  sale_channel = 'guild_member'
  or (ah_price is null and buyer_name is null and member_rate_pct is null)
);

-- boe_record_sale takes the buyer as one more optional argument. Given, the
-- sale is to a guild member and p_sale_price is what the item would have
-- sold for on the auction house; left out, the sale is an auction house sale
-- exactly as before, so both BoE pages keep calling it with the id and the
-- price alone. A new argument and new returned columns are a new signature,
-- hence drop and create, and the grants go with the old function.
drop function public.boe_record_sale(integer, bigint, timestamptz);

create function public.boe_record_sale(
  p_id integer,
  p_sale_price bigint,
  p_sold_at timestamptz default null,
  p_buyer_name text default null
) returns table(
  sale_price bigint,
  finder_payout bigint,
  guild_cut bigint,
  ah_fee bigint,
  sale_channel text,
  ah_price bigint,
  buyer_name text,
  member_rate_pct integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The game's fixed auction house cut (#861), verified against two real
  -- mails. Not a setting: nothing reads it but this function and the
  -- backfill that introduced the column.
  c_ah_fee_pct constant numeric := 5;
  -- Guild policy (#1593): what a guild member pays is rounded down to this,
  -- and the guild takes the difference. boe_items_member_sale_shape holds
  -- the same figure.
  c_member_round_to constant bigint := 1000;
  v_team_id integer;
  v_status text;
  v_item_name text;
  v_floor bigint;
  v_pivot bigint;
  v_rate integer;
  v_channel text;
  v_buyer text;
  v_ah bigint;
  v_paid bigint;
  v_fee bigint;
  v_payout bigint;
begin
  select b.team_id, b.status, b.item_name into v_team_id, v_status, v_item_name
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

  if p_buyer_name is not null then
    -- Any run of whitespace, a pasted tab or line break included, becomes one
    -- space; btrim alone takes off spaces only.
    v_buyer := btrim(regexp_replace(p_buyer_name, '\s+', ' ', 'g'));
    if v_buyer = '' then
      raise exception 'Buyer name is required for a sale to a guild member';
    end if;
    if char_length(v_buyer) > 100 then
      raise exception 'Buyer name is too long (100 characters at most)';
    end if;
  end if;

  select s.boe_payout_floor, s.boe_payout_pivot, s.boe_member_rate_pct into v_floor, v_pivot, v_rate
  from public.site_settings s where s.id = 1;

  if v_buyer is null then
    -- Whole gold, half away from zero: silver and copper are ignored by
    -- decision (a 47,999 sale carries a 2,399g 95s cut in game and 2,400
    -- here), the same rounding the payout uses.
    v_channel := 'auction_house';
    v_fee := round(p_sale_price::numeric * c_ah_fee_pct / 100)::bigint;
    v_ah := null;
    v_paid := p_sale_price;
    v_rate := null;
  else
    -- Nothing went through the auction house. The buyer pays the rate of
    -- what it would have sold for there, rounded down to the thousand in
    -- whole-number arithmetic, and the cut is figured on the auction house
    -- price (#1593).
    v_channel := 'guild_member';
    v_fee := 0;
    v_ah := p_sale_price;
    v_paid := p_sale_price * v_rate / (100 * c_member_round_to) * c_member_round_to;
    if v_paid <= 0 then
      raise exception 'What they pay rounds to zero at this rate';
    end if;
  end if;

  -- Guild policy (#745 comment): 20%-of-gross or the floor, whichever is
  -- larger, rounded to the nearest gold half away from zero, and never more
  -- than what came in net of the fee (#861), so the guild is never out of
  -- pocket on a sub-floor sale. The guild keeps what is left after the fee.
  v_payout := least(v_paid - v_fee, greatest(v_floor, round(p_sale_price::numeric * v_floor / v_pivot)))::bigint;

  update public.boe_items b
  set status = 'sold',
      sold_at = coalesce(p_sold_at, now()),
      sale_price = v_paid,
      finder_payout = v_payout,
      guild_cut = v_paid - v_fee - v_payout,
      ah_fee = v_fee,
      payout_floor = v_floor,
      payout_pivot = v_pivot,
      sale_channel = v_channel,
      ah_price = v_ah,
      buyer_name = v_buyer,
      member_rate_pct = v_rate
  where b.id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Sale Recorded', 'boe_items', p_id,
    to_jsonb(case when v_channel = 'guild_member'
      then v_item_name || ' sold to ' || v_buyer || ' for ' || public.format_boe_gold(v_paid) ||
        'g (' || v_rate || '% of the auction house price ' || public.format_boe_gold(v_ah) ||
        'g, rounded down to the thousand); finder payout ' || public.format_boe_gold(v_payout) || 'g'
      else v_item_name || ' sold for ' || public.format_boe_gold(v_paid) ||
        'g; finder payout ' || public.format_boe_gold(v_payout) || 'g'
    end));

  return query select v_paid, v_payout, v_paid - v_fee - v_payout, v_fee,
    v_channel, v_ah, v_buyer, v_rate;
end $$;

revoke all on function public.boe_record_sale(integer, bigint, timestamptz, text) from public;
revoke execute on function public.boe_record_sale(integer, bigint, timestamptz, text) from anon;
grant execute on function public.boe_record_sale(integer, bigint, timestamptz, text) to authenticated;

-- boe_revert's sold edge clears the whole receipt, which now includes the
-- channel and the three guild member columns. Same signature, so create or
-- replace; the body is otherwise the #770 one.
create or replace function public.boe_revert(p_id integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  v_team_id integer;
  v_item_name text;
  v_new text;
begin
  select b.status, b.team_id, b.item_name into v_status, v_team_id, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if v_status = 'paid' then
    if not public.can_settle_boe(v_team_id) then
      raise exception 'Not authorized';
    end if;
  elsif not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_status = 'paid' then
    update public.boe_items set status = 'sold', payout_paid_at = null where id = p_id;
    v_new := 'sold';
  elsif v_status = 'sold' then
    select case when exists (select 1 from public.boe_listings l where l.boe_item_id = p_id)
      then 'listed' else 'found' end into v_new;
    update public.boe_items
    set status = v_new, sold_at = null, sale_price = null, finder_payout = null,
        guild_cut = null, ah_fee = null, payout_floor = null, payout_pivot = null,
        sale_channel = null, ah_price = null, buyer_name = null, member_rate_pct = null
    where id = p_id;
  elsif v_status = 'listed' then
    if exists (select 1 from public.boe_listings l where l.boe_item_id = p_id) then
      raise exception 'Delete the listing rows first to revert a listed BoE to found';
    end if;
    update public.boe_items set status = 'found' where id = p_id;
    v_new := 'found';
  elsif v_status = 'retired' then
    update public.boe_items set status = 'found', retired_at = null where id = p_id;
    v_new := 'found';
  else
    raise exception 'Nothing to revert on a found BoE';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Reverted', 'boe_items', p_id,
    to_jsonb(v_item_name || ': ' || v_status || ' back to ' || v_new));

  return v_new;
end $function$;
