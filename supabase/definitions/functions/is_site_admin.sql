-- Function public.is_site_admin: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.is_site_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.grant_type = 'site_admin'
  );
$function$;
