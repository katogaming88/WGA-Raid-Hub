-- Function public.guild_active_recruiters: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.guild_active_recruiters(p_guild_key text)
 RETURNS TABLE(name text, code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select n.name, r.code
    from guild_recruiters r
    join guilds g on g.id = r.guild_id
    cross join lateral (select guild_person_public_name(r.guild_id, r.person_id) as name) n
   where g.url_key = p_guild_key and r.active and in_guild(r.guild_id, r.person_id)
     and n.name is not null
   order by 1, 2;
$function$;
