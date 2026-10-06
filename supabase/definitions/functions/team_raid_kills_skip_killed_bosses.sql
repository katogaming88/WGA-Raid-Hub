-- Function public.team_raid_kills_skip_killed_bosses: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_raid_kills_skip_killed_bosses()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.skip_killed_bosses(array(select id from new_kills));
  exception when others then
    raise warning 'Kills % were stored, but taking their bosses off later nights failed: %',
      (select array_agg(id order by id) from new_kills), sqlerrm;
  end;
  return null;
end;
$function$;
