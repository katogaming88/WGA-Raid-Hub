-- Function public.battlenet_account_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.battlenet_account_id(p_auth_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.provider_id
    from auth.identities i
   where i.user_id = p_auth_user_id
     and i.provider = 'custom:battlenet';
$function$;
