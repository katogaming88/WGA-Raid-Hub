-- Function public.my_audit_character_keys: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_audit_character_keys()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct k.key), '{}')
    from (
      select p.name_realm_key as key
        from players p
       where p.archived_at is null
         and (p.team_id in (select tm.team_id from team_members tm
                             where tm.person_id = my_person_id() and tm.archived_at is null)
              or p.team_id = any (my_guild_permission_team_ids('view_every_team')))
      union all
      select c.name_realm_key from characters c where c.person_id = my_person_id()
      union all
      select p.name_realm_key from players p where p.id = any (my_player_ids())
    ) k
   where k.key is not null and auth.uid() is not null;
$function$;
