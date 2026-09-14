-- Function public.set_boe_payout_settings: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boe_payout_settings(p_floor bigint, p_pivot bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  update public.site_settings
  set boe_payout_floor = p_floor, boe_payout_pivot = p_pivot, updated_at = now()
  where id = 1;

  perform public.write_audit_log(
    null,
    'boe_payout_settings_updated',
    'site_settings',
    null,
    jsonb_build_object('floor', p_floor, 'pivot', p_pivot)
  );
end $function$;
