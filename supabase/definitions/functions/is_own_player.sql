-- Function public.is_own_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.is_own_player(p_player_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from players p
    join team_members tm on tm.id = p.team_member_id
    where p.id = p_player_id
      and p.archived_at is null
      and tm.auth_user_id = auth.uid()
  );
$function$;
