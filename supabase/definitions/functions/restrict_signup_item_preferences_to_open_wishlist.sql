-- Function public.restrict_signup_item_preferences_to_open_wishlist: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.restrict_signup_item_preferences_to_open_wishlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_signup_id integer;
begin
  if current_user = 'authenticated' then
    foreach v_signup_id in array case
        when tg_op = 'INSERT' then array[new.signup_id]
        when tg_op = 'DELETE' then array[old.signup_id]
        else array[old.signup_id, new.signup_id]
      end
    loop
      if not public.signup_wishlist_open(v_signup_id) then
        raise exception 'wishlist editing is not open for that season on this team';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $function$;
