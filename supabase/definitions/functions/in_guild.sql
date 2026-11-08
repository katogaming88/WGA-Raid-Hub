-- Function public.in_guild: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.in_guild(p_guild_id integer, p_person_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from guild_ranks g
                  where g.guild_id = p_guild_id and g.person_id = p_person_id and g.rank <> 'member')
      or exists (select 1 from team_members m join teams t on t.id = m.team_id
                  where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null);
$function$;
