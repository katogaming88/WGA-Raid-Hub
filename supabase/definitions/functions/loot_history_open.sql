-- Function public.loot_history_open: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.loot_history_open(p_team_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
           (select config ->> 'lootHistoryAccess' from public.team_settings where team_id = p_team_id),
           'team'
         ) <> 'officers'
      or p_team_id = any (public.my_permission_team_ids('view_loot'))
      or p_team_id = any (public.my_permission_team_ids('manage_loot'))
      or public.is_site_admin();
$function$;
