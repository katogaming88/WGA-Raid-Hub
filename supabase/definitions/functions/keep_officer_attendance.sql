-- Function public.keep_officer_attendance: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.keep_officer_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.source = 'Officer' and new.source is distinct from 'Officer' then
    return old;
  end if;
  return new;
end;
$function$;
