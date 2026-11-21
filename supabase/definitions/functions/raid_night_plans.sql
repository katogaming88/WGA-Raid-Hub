-- Function public.raid_night_plans: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.raid_night_plans(p_team_id integer, p_raid_date date)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with def as (
    select (select default_difficulty from team_schedule_settings where team_id = p_team_id) as d
  ),
  night as (
    select case
             when exists (select 1 from raid_schedule_exceptions
                          where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'added')
               then (select coalesce(e.difficulty, def.d) from raid_schedule_exceptions e
                     where e.team_id = p_team_id and e.raid_date = p_raid_date and e.exception_type = 'added')
             else (select coalesce(r.difficulty, def.d) from raid_schedule r
                   where r.team_id = p_team_id and r.active and r.weekday = extract(dow from p_raid_date))
           end as difficulty
    from def
  )
  select case night.difficulty
           when 'heroic' then array['heroic']
           when 'heroic_into_mythic' then array['heroic', 'mythic']
           else array['mythic']
         end
  from night;
$function$;
