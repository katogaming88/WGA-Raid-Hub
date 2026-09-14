-- Function public.is_optional_raid_night: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.is_optional_raid_night(p_team_id integer, p_raid_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select is_optional
      from raid_schedule_exceptions
      where team_id = p_team_id
        and raid_date = p_raid_date
        and exception_type = 'added'
    ),
    (
      select rs.is_optional
      from raid_schedule rs
      where rs.team_id = p_team_id
        and rs.active
        and rs.weekday = extract(dow from p_raid_date)
        and not exists (
          select 1 from raid_schedule_exceptions ex
          where ex.team_id = p_team_id
            and ex.raid_date = p_raid_date
            and ex.exception_type = 'cancelled'
        )
    ),
    false
  );
$function$;
