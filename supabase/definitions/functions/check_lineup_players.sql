-- Function public.check_lineup_players: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.check_lineup_players(p_team_id integer, p_player_ids integer[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if p_player_ids is null or array_position(p_player_ids, null) is not null then
    raise exception 'The lineup must be a list of raiders.';
  end if;

  if cardinality(p_player_ids) <> (select count(distinct x) from unnest(p_player_ids) x) then
    raise exception 'A raider is listed twice.';
  end if;

  if exists (
    select 1 from unnest(p_player_ids) x
    left join players p on p.id = x and p.team_id = p_team_id and p.archived_at is null
    where p.id is null
  ) then
    raise exception 'Every raider in the lineup must be on this team.';
  end if;
end;
$function$;
