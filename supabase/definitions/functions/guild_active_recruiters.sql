-- Function public.guild_active_recruiters: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.guild_active_recruiters(p_guild_key text)
 RETURNS TABLE(name text, code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select guild_person_name(r.guild_id, r.person_id), r.code
    from guild_recruiters r
    join guilds g on g.id = r.guild_id
   where g.url_key = p_guild_key and r.active and in_guild(r.guild_id, r.person_id)
   order by 1, 2;
$function$;
