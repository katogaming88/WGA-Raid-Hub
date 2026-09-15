-- Function public.copy_person_account_to_members: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.copy_person_account_to_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update team_members
     set auth_user_id = new.auth_user_id
   where person_id = new.id
     and auth_user_id is distinct from new.auth_user_id;
  return null;
end;
$function$;
