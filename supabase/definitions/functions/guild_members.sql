-- Function public.guild_members: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.guild_members(p_guild_id integer)
 RETURNS TABLE(person_id integer, display_name text, rank text, is_you boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.has_guild_permission(p_guild_id, 'edit_guild_profile') then
    raise exception 'Not authorized';
  end if;

  return query
  with members as (
    select g.person_id from guild_ranks g where g.guild_id = p_guild_id
    union
    select m.person_id
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.archived_at is null and m.person_id is not null
  )
  select
    pe.id,
    -- Their Name on a team in this guild, else their Discord name, as
    -- team_unnamed_members() reads it.
    coalesce(
      (select min(n.label)
         from names n
         join team_members m on m.id = n.team_member_id
         join teams t on t.id = m.team_id
        where m.person_id = pe.id and t.guild_id = p_guild_id),
      (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                       nullif(i.identity_data ->> 'full_name', ''),
                       nullif(i.identity_data ->> 'name', ''))
         from auth.identities i
        where i.user_id = pe.auth_user_id and i.provider = 'discord'
        order by i.created_at desc
        limit 1),
      'Unnamed'),
    coalesce(g.rank, 'member'),
    pe.id = my_person_id()
    from members s
    join people pe on pe.id = s.person_id
    left join guild_ranks g on g.guild_id = p_guild_id and g.person_id = pe.id
   order by array_position(array['owner', 'admin', 'team_lead', 'member'], coalesce(g.rank, 'member')), 2;
end;
$function$;
