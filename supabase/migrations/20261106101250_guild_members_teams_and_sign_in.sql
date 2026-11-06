-- #1650: the Members tab as a table. guild_members() also returns each
-- person's current teams in the guild with their team rank, when they last
-- signed in, and their characters' names (the search box looks in them).
--
-- The return type changes, so the function is dropped and made again with the
-- same body and the same checks: signed in, and the guild Owner or anyone whose
-- rank has edit_guild_profile. Same grants as before.

drop function public.guild_members(integer);

create function public.guild_members(p_guild_id integer)
returns table (
  person_id integer,
  display_name text,
  rank text,
  is_you boolean,
  teams jsonb,
  last_sign_in timestamptz,
  characters text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.has_guild_permission(p_guild_id, 'edit_guild_profile') then
    raise exception 'Not authorized';
  end if;

  return query
  with members as (
    select g.person_id from guild_ranks g where g.guild_id = p_guild_id and g.rank <> 'member'
    union
    select m.person_id
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.archived_at is null and m.person_id is not null
  )
  select
    pe.id,
    -- Their Name on a current team in this guild, else their Discord name,
    -- as team_unnamed_members() reads it.
    coalesce(
      (select min(n.label)
         from names n
         join team_members m on m.id = n.team_member_id
         join teams t on t.id = m.team_id
        where m.person_id = pe.id and t.guild_id = p_guild_id and m.archived_at is null),
      (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                       nullif(i.identity_data ->> 'full_name', ''),
                       nullif(i.identity_data ->> 'name', ''))
         from auth.identities i
        where i.user_id = pe.auth_user_id and i.provider = 'discord'
        order by i.created_at desc
        limit 1),
      'Unnamed'),
    coalesce(g.rank, 'member'),
    pe.id = my_person_id(),
    coalesce(
      (select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'rank', m.rank)
                        order by t.name)
         from team_members m
         join teams t on t.id = m.team_id
        where m.person_id = pe.id and t.guild_id = p_guild_id and m.archived_at is null),
      '[]'::jsonb),
    (select u.last_sign_in_at from auth.users u where u.id = pe.auth_user_id),
    coalesce(
      (select array_agg(c.name_realm order by c.name_realm)
         from characters c
        where c.person_id = pe.id and c.name_realm is not null),
      '{}'::text[])
    from members s
    join people pe on pe.id = s.person_id
    left join guild_ranks g on g.guild_id = p_guild_id and g.person_id = pe.id
   order by array_position(array['owner', 'admin', 'team_lead', 'member'], coalesce(g.rank, 'member')), 2;
end;
$$;

comment on function public.guild_members(integer) is
  'Everyone in a guild (a guild_ranks row there, or on a current team of it), with a name to show, their guild rank, whether it is the caller, their current teams there with team rank, when they last signed in and their characters'' names (#1650). For the Owner and anyone whose rank has edit_guild_profile.';

revoke all on function public.guild_members(integer) from public, anon;
grant execute on function public.guild_members(integer) to authenticated;
