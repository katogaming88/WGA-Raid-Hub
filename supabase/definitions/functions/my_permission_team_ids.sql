-- Function public.my_permission_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_permission_team_ids(p_permission text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranks as (
    select m.team_id, m.rank
      from team_members m
     where m.person_id = my_person_id() and m.archived_at is null
    union all
    -- "See every team, read-only" on the guild grid (#1647): the read-only
    -- permissions, as an Officer. Nothing that writes asks any of these four.
    select t.id, 'officer'
      from teams t
     where p_permission in ('see_rsvps', 'view_reports', 'view_loot', 'view_team_audit_log')
       and has_guild_permission(t.guild_id, 'view_every_team')
  )
  select coalesce(array_agg(distinct r.team_id), '{}')
    from ranks r
   where exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'team')
     and (r.rank = 'owner'
          or exists (select 1 from team_rank_permissions p
                      where p.team_id = r.team_id and p.rank = r.rank
                        and p.permission = p_permission));
$function$;
