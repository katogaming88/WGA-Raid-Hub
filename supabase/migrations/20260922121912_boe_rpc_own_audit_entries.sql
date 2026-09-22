-- #770: the five BoE lifecycle RPCs write their own audit_log entry inside
-- their own transaction instead of through a separate client call, and a new
-- boe_edit_item RPC replaces the raw client UPDATE saveBoeEdit() used so it
-- can do the same. write_audit_log()'s is_boe_manager() OR then comes off.
--
-- #766 added that OR only so a BoE manager holding no officer role anywhere
-- would not silently fail the client's writeAuditLog() call after a
-- lifecycle mutation. But write_audit_log(p_team_id, p_action, p_target_type,
-- p_target_id, p_detail) takes every field from the caller, so the OR also
-- let a manager append an audit row for any team, action, or target -- reach
-- past the narrow money role the grant is meant to be. The five RPCs are
-- already SECURITY DEFINER running as postgres, so they can insert into
-- audit_log directly without going through that gate at all, which closes
-- the reach and also makes the entry land in the same transaction as the
-- mutation instead of a separate client call that only console.warns on
-- failure.
--
-- boe_edit_item exists because saveBoeEdit() (#874) turned out to have the
-- same shape: a plain client-side UPDATE of boe_items, gated by the same
-- is_boe_manager() OR is_site_admin() gate the five RPCs check (via RLS),
-- that also called writeAuditLog() afterward. Dropping the OR without giving
-- it an RPC of its own would reintroduce the exact silent-failure bug #770
-- exists to fix, just on a sixth path. The direct-UPDATE route and its RLS
-- rule are left alone; boe_edit_item is an additional, RPC-shaped way in.
--
-- is_guild_officer()'s OR on write_audit_log is untouched (#770's question 2
-- -- it is load-bearing for the player/attendance/bio writes #607 added it
-- for, unrelated to this).

-- Internal helper, not a public RPC: mirrors formatGold() in
-- js/boe-manage.js so the entries below read exactly like the client-built
-- ones did. FM strips the padding to_char would otherwise leave. `stable`,
-- not `immutable`: to_char(bigint, text)'s output depends on lc_numeric, so
-- Postgres marks the whole to_char family stable and a wrapper cannot claim
-- more than its ingredients. Seven comma groups (21 nines) rather than five,
-- so the mask does not run out before bigint's own range does (max
-- 9,223,372,036,854,775,807, 19 digits) -- to_char renders '#'*19 past the
-- mask's width instead of the number, and a mistyped 16+ digit sale price is
-- the one input here big enough to reach a five-group mask's ceiling.
create or replace function public.format_boe_gold(n bigint) returns text
language sql stable
set search_path = public
as $$ select trim(to_char(n, 'FM999,999,999,999,999,999,999')); $$;

revoke all on function public.format_boe_gold(bigint) from public;

create or replace function public.boe_record_listing(
  p_id integer,
  p_price bigint,
  p_listed_at timestamptz default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_status text;
  v_item_name text;
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
    raise exception 'Cannot record a listing on a % BoE', v_status;
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Listing price must be zero or more';
  end if;

  insert into public.boe_listings (team_id, boe_item_id, price, listed_at, note)
  values (v_team_id, p_id, p_price, coalesce(p_listed_at, now()), nullif(trim(coalesce(p_note, '')), ''));

  update public.boe_items set status = 'listed' where id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Listed', 'boe_items', p_id,
    to_jsonb(v_item_name || ' listed for ' || public.format_boe_gold(p_price) || 'g'));
end $$;

create or replace function public.boe_record_sale(
  p_id integer,
  p_sale_price bigint,
  p_sold_at timestamptz default null
) returns table(sale_price bigint, finder_payout bigint, guild_cut bigint, ah_fee bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The game's fixed auction house cut (#861), verified against two real
  -- mails. Not a setting: nothing reads it but this function and the
  -- backfill that introduced the column.
  c_ah_fee_pct constant numeric := 5;
  v_team_id integer;
  v_status text;
  v_item_name text;
  v_floor bigint;
  v_pivot bigint;
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

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Sale Recorded', 'boe_items', p_id,
    to_jsonb(v_item_name || ' sold for ' || public.format_boe_gold(p_sale_price) ||
      'g; finder payout ' || public.format_boe_gold(v_payout) || 'g'));

  return query select p_sale_price, v_payout, p_sale_price - v_fee - v_payout, v_fee;
end $$;

create or replace function public.boe_mark_paid(
  p_id integer,
  p_paid_at timestamptz default null,
  p_donated boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

create or replace function public.boe_retire(
  p_id integer,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_team_id integer;
  v_item_name text;
begin
  select b.status, b.team_id, b.item_name into v_status, v_team_id, v_item_name
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot retire a % BoE', v_status;
  end if;

  update public.boe_items
  set status = 'retired', retired_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_id;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, auth.uid(), 'BoE Retired', 'boe_items', p_id, to_jsonb(v_item_name));
end $$;

-- Correction edges. sold walks back to listed while listing rows exist
-- (else found) and nulls the whole money receipt; listed refuses while
-- listing rows exist, since deleting the junk listing is the correction
-- that makes 'found' true again. The audit insert sits once at the end,
-- after v_new is settled by whichever branch ran, rather than repeated in
-- each branch -- v_status (the "from") is read once up front and none of
-- the branches touch it.
create or replace function public.boe_revert(p_id integer) returns text
language plpgsql
security definer
set search_path = public
as $$
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
        guild_cut = null, ah_fee = null, payout_floor = null, payout_pivot = null
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
end $$;

-- Replaces the raw `update boe_items ... where id = p_id` saveBoeEdit() used
-- (js/boe-manage.js #874), for the reason in this migration's header: that
-- path shared write_audit_log()'s is_boe_manager() OR and needs its own
-- audit write now that the OR is gone. Same gate as the five RPCs above
-- (RLS's "BoE managers update boe_items" rule, is_boe_manager() or
-- is_site_admin(), no officer fallback), and the same five columns
-- check_boe_status_transition already admits from a direct UPDATE. The
-- detail string mirrors _boeEditChanges()/_boeEditDetail() in
-- js/boe-manage.js exactly: one clause per changed column, joined with '; ',
-- null rendered as (none). Writes nothing when nothing changed.
create or replace function public.boe_edit_item(
  p_id integer,
  p_item_name text,
  p_track text,
  p_note text,
  p_item_id integer,
  p_upgrade_rank text
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

revoke all on function public.boe_edit_item(integer, text, text, text, integer, text) from public;
grant execute on function public.boe_edit_item(integer, text, text, text, integer, text) to authenticated;

-- The narrower gate (#770): a BoE manager's audit entries now come from the
-- RPCs above, in the same transaction as the mutation, so write_audit_log()
-- no longer needs to admit the grant at all. is_guild_officer() is
-- untouched -- load-bearing for #607's player/attendance/bio writes, a
-- separate question from this one.
create or replace function public.write_audit_log(
  p_team_id integer,
  p_action text,
  p_target_type text default null,
  p_target_id integer default null,
  p_detail jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin() or public.is_guild_officer()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;
