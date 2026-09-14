-- Function public.my_active_player_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_active_player_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(p.id), '{}')
    from players p
    join team_members tm on tm.id = p.team_member_id
   where tm.auth_user_id = auth.uid()
     and p.archived_at is null;
$function$;
