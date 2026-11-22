-- Function public.my_loot_import_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_loot_import_team_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(t.id), '{}')
    from public.teams t
   where (t.id = any (public.my_permission_team_ids('manage_loot'))
          and coalesce(
                (select s.config ->> 'lootImportAccess' from public.team_settings s where s.team_id = t.id),
                'officers'
              ) <> 'leader')
      or t.id = any (public.my_leader_team_ids());
$function$;
