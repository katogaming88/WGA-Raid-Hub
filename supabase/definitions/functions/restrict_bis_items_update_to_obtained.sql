-- Function public.restrict_bis_items_update_to_obtained: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.restrict_bis_items_update_to_obtained()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.item_id is distinct from old.item_id
    or new.player_id is distinct from old.player_id
    or new.slot is distinct from old.slot
    or new.season is distinct from old.season
  then
    raise exception 'bis_items updates may only change obtained';
  end if;
  return new;
end $function$;
