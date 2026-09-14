-- Function public.admin_list_guild_officers: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.admin_list_guild_officers()
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
    select g.id, g.discord_id, g.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.guild_officers g
    left join auth.users u on u.id = g.auth_user_id
    order by g.id;
end;
$function$;
