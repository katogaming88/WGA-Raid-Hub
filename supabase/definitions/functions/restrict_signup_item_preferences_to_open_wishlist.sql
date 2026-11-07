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
  v_team_id integer;
begin
  if current_user = 'authenticated' then
    foreach v_signup_id in array case
        when tg_op = 'INSERT' then array[new.signup_id]
        when tg_op = 'DELETE' then array[old.signup_id]
        else array[old.signup_id, new.signup_id]
      end
    loop
      select s.team_id into v_team_id from public.season_signups s where s.id = v_signup_id;
      if exists (select 1 from public.team_members m
                  where m.team_id = v_team_id and m.person_id = public.my_person_id()
                    and m.archived_at is null)
         and not public.has_team_permission(v_team_id, 'edit_own_wishlist') then
        raise exception 'your rank cannot edit its wishlist on this team';
      end if;
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
