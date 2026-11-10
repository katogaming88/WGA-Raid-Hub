-- Function public.recruit_actor_access: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_actor_access(p_team_id integer, p_person_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when exists (select 1 from guild_grants g where g.person_id = p_person_id and g.grant_type = 'site_admin')
      or exists (select 1 from team_members m
                  where m.team_id = p_team_id and m.person_id = p_person_id and m.archived_at is null
                    and (m.rank = 'owner'
                         or exists (select 1 from team_rank_permissions k
                                     where k.team_id = m.team_id and k.rank = m.rank
                                       and k.permission = 'edit_recruiting'))) then 'manage'
    when exists (select 1 from team_recruiting r
                   join team_members m on m.team_id = r.team_id
                  where r.team_id = p_team_id and r.visible_to_team_assistants
                    and m.person_id = p_person_id and m.archived_at is null and m.rank = 'assistant') then 'note'
  end;
$function$;
