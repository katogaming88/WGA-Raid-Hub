-- Function public.text_items_match: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.text_items_match(p_items text[], p_pattern text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select not exists (select 1 from unnest(p_items) as i where i is null or i !~ p_pattern);
$function$;
