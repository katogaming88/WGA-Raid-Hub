-- Function public.recruit_access: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.recruit_access(p_team_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin() then 'manage'
    when exists (select 1 from team_recruiting r
                   join team_members m on m.team_id = r.team_id
                  where r.team_id = p_team_id and r.visible_to_team_assistants
                    and m.person_id = my_person_id() and m.archived_at is null and m.rank = 'assistant') then 'note'
    when exists (select 1 from team_recruiting r
                   join teams t on t.id = r.team_id
                  where r.team_id = p_team_id
                    and ((r.visible_to_guild_admins
                          and exists (select 1 from guild_ranks g
                                       where g.guild_id = t.guild_id and g.person_id = my_person_id()
                                         and g.rank in ('owner', 'admin')))
                         or has_guild_permission(t.guild_id, 'view_every_team'))) then 'read'
  end;
$function$;
