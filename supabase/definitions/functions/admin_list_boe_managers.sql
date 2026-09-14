-- Function public.admin_list_boe_managers: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_list_boe_managers()
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
    select b.id, b.discord_id, b.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.boe_managers b
    left join auth.users u on u.id = b.auth_user_id
    order by b.id;
end;
$function$;
