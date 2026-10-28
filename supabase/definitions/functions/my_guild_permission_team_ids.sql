-- Function public.my_guild_permission_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_guild_permission_team_ids(p_permission text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(t.id), '{}')
    from teams t
   where t.guild_id in (select g.id from guilds g where has_guild_permission(g.id, p_permission));
$function$;
