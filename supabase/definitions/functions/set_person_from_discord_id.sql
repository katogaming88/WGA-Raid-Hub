-- Function public.set_person_from_discord_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.set_person_from_discord_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.person_id := person_for_discord_id(new.discord_id);
  -- Joined to auth.users so that deleting an account works: the foreign key
  -- nulls this row's copy before it nulls the person's, and copying the
  -- person's not-yet-nulled account back would name a deleted account.
  new.auth_user_id := (
    select u.id from people p join auth.users u on u.id = p.auth_user_id where p.id = new.person_id
  );
  return new;
end;
$function$;
