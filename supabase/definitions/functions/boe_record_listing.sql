-- Function public.boe_record_listing: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.boe_record_listing(p_id integer, p_price bigint, p_listed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
