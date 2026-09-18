-- Function public.set_encounter_cap: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_encounter_cap(p_encounter_id integer, p_cap integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (public.is_guild_officer() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  if p_cap is not null and (p_cap <= 0 or p_cap > 30) then
    raise exception 'A boss cap has to be between 1 and 30.';
  end if;

  update raid_encounters set cap = p_cap where id = p_encounter_id;

  perform public.write_audit_log(null, 'Set Boss Cap', 'raid_encounters', p_encounter_id, jsonb_build_object('cap', p_cap));
end;
$function$;
