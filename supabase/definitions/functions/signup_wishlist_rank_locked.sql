-- Function public.signup_wishlist_rank_locked: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.signup_wishlist_rank_locked(p_signup_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from season_signups s
      join team_members m on m.team_id = s.team_id and m.person_id = my_person_id()
                         and m.archived_at is null
     where s.id = p_signup_id and not has_team_permission(s.team_id, 'edit_own_wishlist')
  );
$function$;
