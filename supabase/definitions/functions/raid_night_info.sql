-- Function public.raid_night_info: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.raid_night_info(p_team_id integer, p_raid_date date)
 RETURNS TABLE("exists" boolean, start_time time without time zone, timezone text, is_optional boolean, difficulty text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_weekday integer := extract(dow from p_raid_date);
  v_cancelled boolean;
  v_added raid_schedule_exceptions%rowtype;
  v_rule raid_schedule%rowtype;
  v_default text;
  v_difficulty text;
begin
  select true into v_cancelled
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'cancelled';

  if v_cancelled then
    return query select false, null::time, null::text, null::boolean, null::text;
    return;
  end if;

  select default_difficulty into v_default
  from team_schedule_settings
  where team_id = p_team_id;

  select * into v_added
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'added';

  if found then
    v_difficulty := coalesce(v_added.difficulty, v_default);
    return query select true, v_added.start_time, 'America/New_York'::text, v_added.is_optional,
      case v_difficulty when 'heroic_into_mythic' then 'mythic' else v_difficulty end;
    return;
  end if;

  select * into v_rule
  from raid_schedule
  where team_id = p_team_id and active and weekday = v_weekday;

  if found then
    v_difficulty := coalesce(v_rule.difficulty, v_default);
    return query select true, v_rule.start_time, v_rule.timezone, v_rule.is_optional,
      case v_difficulty when 'heroic_into_mythic' then 'mythic' else v_difficulty end;
    return;
  end if;

  return query select false, null::time, null::text, null::boolean, null::text;
end;
$function$;
