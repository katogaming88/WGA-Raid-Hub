-- Function public.team_member_name: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_member_name(p_team_id integer, p_team_member_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select min(n.label) from names n where n.team_id = p_team_id and n.team_member_id = p_team_member_id),
    (select split_part(p.name_realm, '-', 1) from players p
      where p.team_id = p_team_id and p.team_member_id = p_team_member_id
      order by p.archived_at is not null, p.name_realm
      limit 1),
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from team_members m
       join people pe on pe.id = m.person_id
       join auth.identities i on i.user_id = pe.auth_user_id and i.provider = 'discord'
      where m.id = p_team_member_id
      order by i.created_at desc
      limit 1),
    'Unnamed');
$function$;
