-- Function public.check_boe_status_transition: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.check_boe_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (to_jsonb(new) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'upgrade_rank' - 'season' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'upgrade_rank' - 'season' - 'updated_at') then
    raise exception 'Direct updates may only edit note, finder, item, track, rank, or season; lifecycle changes go through the BoE RPCs';
  end if;
  return new;
end $function$;
