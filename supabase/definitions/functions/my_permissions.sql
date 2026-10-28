-- Function public.my_permissions: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_permissions(p_team_id integer DEFAULT NULL::integer, p_guild_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(k.permission order by k.position)
        from rank_permissions k
       where k.scope = 'team' and has_team_permission(p_team_id, k.permission)
    ), '[]'::jsonb),
    'guild', coalesce((
      select jsonb_agg(k.permission order by k.position)
        from rank_permissions k
       where k.scope = 'guild'
         and has_guild_permission(
               coalesce((select t.guild_id from teams t where t.id = p_team_id), p_guild_id),
               k.permission)
    ), '[]'::jsonb)
  );
$function$;
