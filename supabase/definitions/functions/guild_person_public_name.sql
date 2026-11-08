-- Function public.guild_person_public_name: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.guild_person_public_name(p_guild_id integer, p_person_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select min(n.label)
       from names n
       join team_members m on m.id = n.team_member_id
       join teams t on t.id = m.team_id
      where m.person_id = p_person_id and t.guild_id = p_guild_id and m.archived_at is null),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'global_name', '')
       from people pe
       join auth.identities i on i.user_id = pe.auth_user_id and i.provider = 'discord'
      where pe.id = p_person_id
      order by i.created_at desc
      limit 1));
$function$;
