-- Function public.sync_bis_obtained_from_self_received: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.sync_bis_obtained_from_self_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.player_id is null then
    return new;
  end if;

  update public.bis_items b
     set obtained = true,
         updated_at = now()
   where b.player_id = new.player_id
     and b.item_id = new.self_item_id
     and b.obtained = false
     and (
       -- Slot recorded: fill exactly that row.
       (new.slot is not null and coalesce(b.slot, '') = new.slot)
       -- No slot (a row predating this migration): only safe to infer the
       -- target when the item occupies exactly one slot for this player.
       -- Otherwise leave it for an officer rather than guess.
       or (
         new.slot is null
         and (
           select count(*)
           from public.bis_items b2
           where b2.player_id = new.player_id
             and b2.item_id = new.self_item_id
         ) = 1
       )
     );

  return new;
end $function$;
