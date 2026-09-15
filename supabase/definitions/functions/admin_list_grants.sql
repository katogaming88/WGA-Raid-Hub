-- Function public.admin_list_grants: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.admin_list_grants(p_grant_type text)
 RETURNS TABLE(id integer, discord_id text, auth_user_id uuid, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select g.id, p.discord_id, p.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from guild_grants g
    join people p on p.id = g.person_id
    left join auth.users u on u.id = p.auth_user_id
    where g.grant_type = p_grant_type
    order by g.id;
end;
$function$;
