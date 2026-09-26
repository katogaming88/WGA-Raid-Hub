-- Function public.also_on_teams: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.also_on_teams(p_team_id integer)
 RETURNS TABLE(player_id integer, team_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, t.name
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id and tq.team_id <> p.team_id
    join players q on q.team_member_id = tq.id and q.archived_at is null
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and t.archived_at is null
     and (
       p_team_id = any ((select my_officer_team_ids())::integer[])
       or (select is_site_admin())
       or (select is_guild_officer())
     )
   group by p.id, t.name;
$function$;
