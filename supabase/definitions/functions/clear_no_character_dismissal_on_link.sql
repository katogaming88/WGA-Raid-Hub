-- Function public.clear_no_character_dismissal_on_link: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.clear_no_character_dismissal_on_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from account_preferences ap
   using team_members tm, people pe
   where tm.id = new.team_member_id
     and pe.id = tm.person_id
     and ap.auth_user_id = pe.auth_user_id
     and ap.key = 'no_character_dismissed';
  return new;
end;
$function$;
