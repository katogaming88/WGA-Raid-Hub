-- Function public.is_guild_officer_of: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.is_guild_officer_of(p_guild_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from guild_grants g
      join people p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.guild_id = p_guild_id
       and g.grant_type = 'guild_officer'
  );
$function$;
