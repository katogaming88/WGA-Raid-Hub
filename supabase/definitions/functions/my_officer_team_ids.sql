-- Function public.my_officer_team_ids: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.my_officer_team_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where person_id = my_person_id()
     and role = any (array['officer', 'team_leader']);
$function$;
