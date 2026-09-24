-- Function public.guild_creation_open: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.guild_creation_open()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select s.guild_creation_open from public.site_settings s where s.id = 1), false);
$function$;
