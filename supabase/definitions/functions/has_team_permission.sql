-- Function public.has_team_permission: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.has_team_permission(p_team_id integer, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranks as (
    select m.rank
      from team_members m
     where m.team_id = p_team_id and m.person_id = my_person_id() and m.archived_at is null
    union all
    select 'officer'
      from guild_ranks g
      join teams t on t.guild_id = g.guild_id
     where t.id = p_team_id and g.person_id = my_person_id() and g.officer_on_every_team
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'team')
     and exists (select 1 from ranks r
                  where r.rank = 'owner'
                     or exists (select 1 from team_rank_permissions p
                                 where p.team_id = p_team_id and p.rank = r.rank
                                   and p.permission = p_permission));
$function$;
