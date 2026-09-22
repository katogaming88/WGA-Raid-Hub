-- Function public.team_season_start: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.team_season_start(p_team_id integer, p_season text DEFAULT current_season())
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_tier public.seasons%rowtype;
  v_night date;
begin
  if p_season is null then
    return null;
  end if;

  select * into v_tier from public.seasons where code = p_season;
  if not found then
    raise exception '% is not a season this site knows', p_season;
  end if;

  select min(a.raid_date) into v_night
    from public.attendance a
   where a.team_id = p_team_id
     and a.report_id is not null
     and a.report_excluded = false
     and a.raid_date >= v_tier.starts_at
     and (v_tier.ends_at is null or a.raid_date <= v_tier.ends_at);

  return coalesce(v_night, v_tier.starts_at);
end;
$function$;
