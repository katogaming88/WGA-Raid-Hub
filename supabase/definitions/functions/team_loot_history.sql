-- Function public.team_loot_history: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_loot_history(p_team_id integer)
 RETURNS TABLE(id integer, team_id integer, track text, season text, awarded_at timestamp with time zone, boss text, response text, item_id integer, item_name text, slot text, armor_type text, wow_item_id integer, is_ptr boolean, icon text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not public.loot_history_open(p_team_id) then
    raise exception 'Not authorized';
  end if;
  return query
    select l.id, l.team_id, l.track, l.season, l.awarded_at, l.boss, l.response, l.item_id,
           i.name, i.slot, i.armor_type, i.wow_item_id, i.is_ptr, i.icon
      from public.rclc_loot l
      left join public.items i on i.id = l.item_id
     where l.team_id = p_team_id
     order by l.id;
end;
$function$;
