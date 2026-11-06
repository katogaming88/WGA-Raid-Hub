-- Function public.team_owner_options: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_owner_options(p_team_id integer)
 RETURNS TABLE(team_member_id integer, display_name text, rank text, signed_in boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.has_guild_permission((select t.guild_id from teams t where t.id = p_team_id), 'change_team_owner') then
    raise exception 'Not authorized';
  end if;

  return query
  select
    m.id,
    -- Their Name on this team, else their Discord name, as guild_members() reads it.
    coalesce(
      (select min(n.label) from names n where n.team_id = p_team_id and n.team_member_id = m.id),
      (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                       nullif(i.identity_data ->> 'full_name', ''),
                       nullif(i.identity_data ->> 'name', ''))
         from auth.identities i
        where i.user_id = pe.auth_user_id and i.provider = 'discord'
        order by i.created_at desc
        limit 1),
      'Unnamed'),
    m.rank,
    pe.auth_user_id is not null
    from team_members m
    join people pe on pe.id = m.person_id
   where m.team_id = p_team_id and m.archived_at is null
   order by array_position(array['owner', 'officer', 'assistant', 'raider'], m.rank), 2;
end;
$function$;
