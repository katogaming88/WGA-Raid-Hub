-- Function public.new_url_code: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.new_url_code()
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with r as (select extensions.gen_random_bytes(8) as b)
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', get_byte(r.b, i) % 36 + 1, 1), '' order by i)
    from r, generate_series(0, 7) as i
$function$;
