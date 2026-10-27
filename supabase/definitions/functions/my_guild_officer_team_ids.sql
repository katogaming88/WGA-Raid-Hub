-- Function public.my_guild_officer_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_guild_officer_team_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(t.id), '{}')
    from guild_grants g
    join people p on p.id = g.person_id
    join teams t on t.guild_id = g.guild_id
   where p.auth_user_id = auth.uid()
     and g.grant_type = 'guild_officer';
$function$;
