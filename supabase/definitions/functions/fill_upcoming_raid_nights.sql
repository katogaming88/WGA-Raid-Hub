-- Function public.fill_upcoming_raid_nights: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.fill_upcoming_raid_nights()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
  v_date date;
  v_total integer := 0;
begin
  for v_team in select distinct team_id from boss_groups loop
    for v_date in select (public.raid_today() + d) from generate_series(0, 6) d loop
      if (select i.exists from public.raid_night_info(v_team, v_date) i) then
        perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
        v_total := v_total + public.fill_raid_night(v_team, v_date);
      end if;
    end loop;
  end loop;
  return v_total;
end;
$function$;
