-- Function public.my_sees_every_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_sees_every_team_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(t.id), '{}')
    from guild_ranks g
    join teams t on t.guild_id = g.guild_id
   where g.person_id = my_person_id() and (g.sees_every_team or g.officer_on_every_team);
$function$;
