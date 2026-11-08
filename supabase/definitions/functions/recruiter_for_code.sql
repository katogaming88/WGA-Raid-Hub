-- Function public.recruiter_for_code: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.recruiter_for_code(p_guild_key text, p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('name', guild_person_name(r.guild_id, r.person_id), 'active', r.active)
    from guild_recruiters r
    join guilds g on g.id = r.guild_id
   where g.url_key = p_guild_key and r.code = lower(p_code);
$function$;
