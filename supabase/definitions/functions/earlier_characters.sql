-- Function public.earlier_characters: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.earlier_characters(p_team_id integer)
 RETURNS TABLE(player_id integer, earlier_player_id integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, q.id
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id
    join players q on q.team_member_id = tq.id
   where p.team_id = p_team_id
     and p.archived_at is null
     and q.id <> p.id
     -- An earlier character is one no longer on its roster: an old main on
     -- this team, or a character on a team the person has left (no active
     -- character there any more). A team they are still on keeps its own total.
     and q.archived_at is not null
     and (
       q.team_id = p.team_id
       or not exists (
         select 1 from players r where r.team_member_id = tq.id and r.archived_at is null
       )
     )
     and (
       p_team_id = any ((select my_officer_team_ids())::integer[])
       or (select is_site_admin())
       or (select is_guild_officer())
       or tm.person_id = (select my_person_id())
     );
$function$;
