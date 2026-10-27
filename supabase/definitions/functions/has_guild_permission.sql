-- Function public.has_guild_permission: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.has_guild_permission(p_guild_id integer, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranks as (
    select g.rank
      from guild_ranks g
     where g.guild_id = p_guild_id and g.person_id = my_person_id()
    union all
    select 'member'
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = my_person_id() and m.archived_at is null
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'guild')
     and exists (select 1 from ranks r
                  where r.rank = 'owner'
                     or exists (select 1 from guild_rank_permissions p
                                 where p.guild_id = p_guild_id and p.rank = r.rank
                                   and p.permission = p_permission));
$function$;
