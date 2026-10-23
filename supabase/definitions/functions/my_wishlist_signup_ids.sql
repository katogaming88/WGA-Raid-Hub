-- Function public.my_wishlist_signup_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_wishlist_signup_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(s.id), '{}')
    from season_signups s
   where (s.person_id = my_person_id() or (s.person_id is null and s.auth_user_id = auth.uid()))
     and s.status in ('pending', 'approved')
     and not exists (
           select 1 from players p
            where p.team_id = s.team_id
              and p.archived_at is null
              and p.name_realm_key = lower(replace(s.signup_name_realm, ' ', ''))
         );
$function$;
