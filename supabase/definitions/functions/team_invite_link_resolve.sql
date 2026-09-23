-- Function public.team_invite_link_resolve: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated

CREATE OR REPLACE FUNCTION public.team_invite_link_resolve(p_code text)
 RETURNS TABLE(team_id integer, team_name text, team_slug text, guild_id integer, guild_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.name, t.slug, g.id, g.name
  from public.team_invite_links l
  join public.teams t on t.id = l.team_id
  join public.guilds g on g.id = t.guild_id
  where l.code = p_code
    and (l.expires_at is null or l.expires_at > now());
$function$;
