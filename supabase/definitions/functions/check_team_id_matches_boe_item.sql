-- Function public.check_team_id_matches_boe_item: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.check_team_id_matches_boe_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item_team integer;
begin
  select team_id into v_item_team from public.boe_items where id = new.boe_item_id;
  if v_item_team is not null and v_item_team <> new.team_id then
    raise exception 'boe_listings.team_id % does not match the boe_item team %', new.team_id, v_item_team;
  end if;
  return new;
end $function$;
