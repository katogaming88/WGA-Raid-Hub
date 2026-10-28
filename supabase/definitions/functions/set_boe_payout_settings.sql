-- Function public.set_boe_payout_settings: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boe_payout_settings(p_floor bigint, p_pivot bigint, p_guild_id integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_guild := coalesce(p_guild_id, public.only_guild_id());
  if not (public.is_site_admin() or public.has_guild_permission(v_guild, 'edit_boe_settings')) then
    raise exception 'Not authorized';
  end if;
  if p_floor is null or p_floor < 0 then
    raise exception 'Payout floor must be zero or more';
  end if;
  if p_pivot is null or p_pivot <= 0 then
    raise exception 'Payout pivot must be positive';
  end if;

  update guilds set boe_payout_floor = p_floor, boe_payout_pivot = p_pivot where id = v_guild;
  if not found then
    raise exception 'There is no such guild';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'boe_payout_settings_updated', 'guilds', v_guild,
          jsonb_build_object('floor', p_floor, 'pivot', p_pivot));
end;
$function$;
