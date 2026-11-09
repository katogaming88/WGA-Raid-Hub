-- Function public.application_picture_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.application_picture_team(p_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when (storage.foldername(p_name))[1] ~ '^[1-9][0-9]{0,8}$'
              then ((storage.foldername(p_name))[1])::integer end;
$function$;
