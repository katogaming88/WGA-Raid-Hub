-- Function public.restrict_item_preferences_to_open_wishlist: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.restrict_item_preferences_to_open_wishlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.item_preferences;
begin
  if current_user = 'authenticated' then
    -- An update is checked on both sides, so a row can neither be edited in
    -- a closed season nor moved into one.
    foreach v_row in array case tg_op
        when 'INSERT' then array[new]
        when 'DELETE' then array[old]
        else array[old, new]
      end
    loop
      if public.is_own_player(v_row.player_id)
         and not exists (
           select 1 from public.team_seasons ts
           where ts.team_id = v_row.team_id and ts.season_code = v_row.season and ts.wishlist_open
         )
         and not exists (
           select 1 from public.players p
           where p.id = v_row.player_id and p.wishlist_allowed
         )
      then
        raise exception 'wishlist editing is not open for that season on this team';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $function$;
