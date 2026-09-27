-- Function public.record_raid_night_participation: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.record_raid_night_participation(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_participation (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$function$;
