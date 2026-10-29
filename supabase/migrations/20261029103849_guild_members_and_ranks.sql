-- #1650: the guild's Members tab, its three functions.
--
-- * guild_members(guild_id): everyone in the guild, with a name to show,
--   their guild rank and whether the row is the caller. The Owner and anyone
--   whose rank has edit_guild_profile (Admins by default) may read it, the
--   same people the new app lets onto Guild settings.
-- * set_guild_rank(guild_id, person_id, rank): the Owner makes someone an
--   Admin, a Team Lead or a Member. Never the Owner: that is the next one.
-- * transfer_guild_ownership(guild_id, person_id): the Owner hands the guild
--   to someone else in it and becomes an Admin.
--
-- Someone is in a guild when they hold a rank above Member there or are on a
-- current team of it. Member is automatic, so making someone a Member removes
-- their row. A row left at 'member' (the current site's Revoke Guild Officer
-- leaves one) counts for nothing, so someone who has left every team is not
-- kept in the guild by it (fresh-agent review).
--
-- guild_ranks has no write rule for any client role, so these are the only
-- way the new app changes a rank. The guild_ranks_keep_grant trigger moves
-- the current site's guild_officer grant along with each change.

create function public.guild_members(p_guild_id integer)
returns table (person_id integer, display_name text, rank text, is_you boolean)
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
    pe.id = my_person_id()
    from members s
    join people pe on pe.id = s.person_id
    left join guild_ranks g on g.guild_id = p_guild_id and g.person_id = pe.id
   order by array_position(array['owner', 'admin', 'team_lead', 'member'], coalesce(g.rank, 'member')), 2;
end;
$$;

comment on function public.guild_members(integer) is
  'Everyone in a guild (a guild_ranks row there, or on a current team of it), with a name to show, their guild rank and whether it is the caller (#1650). For the Owner and anyone whose rank has edit_guild_profile.';

revoke all on function public.guild_members(integer) from public, anon;
grant execute on function public.guild_members(integer) to authenticated;

create function public.set_guild_rank(p_guild_id integer, p_person_id integer, p_rank text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- Locking the caller's owner row also waits out a handover in flight.
  perform 1 from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = my_person_id() and g.rank = 'owner'
     for update;
  if not found then
    raise exception 'Not authorized';
  end if;
  if p_rank is null or p_rank not in ('admin', 'team_lead', 'member') then
    raise exception 'A rank is Admin, Team Lead or Member';
  end if;

  select g.rank into v_old
    from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = p_person_id
     for update;
  if v_old = 'owner' then
    raise exception 'That person is the guild''s Owner. Hand the guild to someone else first.';
  end if;
  v_old := coalesce(v_old, 'member');
  if v_old = 'member' and not exists (
    select 1 from team_members m join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null
  ) then
    raise exception 'That person is not in this guild';
  end if;

  if p_rank = 'member' then
    delete from guild_ranks where guild_id = p_guild_id and person_id = p_person_id;
  else
    insert into guild_ranks (guild_id, person_id, rank)
    values (p_guild_id, p_person_id, p_rank)
    on conflict (guild_id, person_id) do update set rank = excluded.rank;
  end if;
  -- Unchanged (a leftover 'member' row is cleared above): nothing to log.
  if v_old = p_rank then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Rank Changed', 'guilds', p_guild_id,
          jsonb_build_object('person_id', p_person_id, 'from', v_old, 'to', p_rank));
end;
$$;

comment on function public.set_guild_rank(integer, integer, text) is
  'The guild Owner makes someone in the guild an Admin, a Team Lead or a Member (#1650). Never the Owner; transfer_guild_ownership() does that.';

revoke all on function public.set_guild_rank(integer, integer, text) from public, anon;
grant execute on function public.set_guild_rank(integer, integer, text) to authenticated;

create function public.transfer_guild_ownership(p_guild_id integer, p_person_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_me integer := my_person_id();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  perform 1 from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = v_me and g.rank = 'owner'
     for update;
  if not found then
    raise exception 'Not authorized';
  end if;
  if p_person_id is null or p_person_id = v_me then
    raise exception 'Pick someone else in the guild';
  end if;

  select g.rank into v_old
    from guild_ranks g
   where g.guild_id = p_guild_id and g.person_id = p_person_id
     for update;
  v_old := coalesce(v_old, 'member');
  if v_old = 'member' and not exists (
    select 1 from team_members m join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = p_person_id and m.archived_at is null
  ) then
    raise exception 'That person is not in this guild';
  end if;
  -- An Owner nobody can sign in as would leave the guild with no one to act
  -- for it (fresh-agent review).
  if not exists (select 1 from people pe where pe.id = p_person_id and pe.auth_user_id is not null) then
    raise exception 'That person has not signed in yet';
  end if;

  -- The caller steps down first: a guild has one owner (guild_ranks_one_owner).
  update guild_ranks set rank = 'admin' where guild_id = p_guild_id and person_id = v_me;
  insert into guild_ranks (guild_id, person_id, rank)
  values (p_guild_id, p_person_id, 'owner')
  on conflict (guild_id, person_id) do update set rank = excluded.rank;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Ownership Transferred', 'guilds', p_guild_id,
          jsonb_build_object('from_person_id', v_me, 'to_person_id', p_person_id,
                             'to_old_rank', v_old));
end;
$$;

comment on function public.transfer_guild_ownership(integer, integer) is
  'The guild Owner hands the guild to someone else in it and becomes an Admin (#1650).';

revoke all on function public.transfer_guild_ownership(integer, integer) from public, anon;
grant execute on function public.transfer_guild_ownership(integer, integer) to authenticated;
