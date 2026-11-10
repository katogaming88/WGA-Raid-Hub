-- Function public.recruit_reason_words: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_reason_words(p_reason text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select upper(left(p_reason, 1)) || replace(substr(p_reason, 2), '_', ' ');
$function$;
