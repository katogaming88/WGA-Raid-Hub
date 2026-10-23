-- Function public.carry_signup_wishlist: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.carry_signup_wishlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'added' and new.approved_player_id is not null then
    if exists (select 1 from signup_item_preferences where signup_id = new.id) then
      delete from item_preferences
       where player_id = new.approved_player_id and season = new.season;
      insert into item_preferences (team_id, player_id, item_id, status, note, slot, season, synced_bis)
      select new.team_id, new.approved_player_id, item_id, status, note, slot, new.season, synced_bis
        from signup_item_preferences
       where signup_id = new.id;
    end if;
  elsif new.status <> 'rejected'
        and lower(replace(new.signup_name_realm, ' ', '')) = lower(replace(old.signup_name_realm, ' ', '')) then
    return new;
  end if;

  delete from signup_item_preferences where signup_id = new.id;
  return new;
end $function$;
