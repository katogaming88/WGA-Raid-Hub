-- #1651: changing a team rank, and who owns a team.
--
-- * set_team_rank(team_id, team_member_id, rank): on the Roster, the Team
--   Owner makes someone an Officer, an Assistant or a Raider. Anyone whose
--   rank has promote_assistants (Officers by default) moves someone between
--   Raider and Assistant only.
-- * team_owner_options(team_id): who can be picked as the new Team Owner.
--   A guild Admin does not read inside a team by default, so the Teams list
--   cannot read team_members itself.
-- * change_team_owner(team_id, team_member_id): on the Teams list, anyone
--   with change_team_owner on the guild's grid (the guild Owner and Admins by
--   default) hands the team to a current member, and the old Team Owner
--   becomes an Officer.
--
-- team_members_guard_rank refuses a rank written directly by a client, so
-- these are the only way the new app changes one. team_members_keep_rank_and_role
-- moves the current site's role along with each change.

create function public.set_team_rank(p_team_id integer, p_team_member_id integer, p_rank text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The team's owner row first, so a handover in flight is waited out and
  -- the check below sees who owns the team once it ends.
  perform 1 from team_members m
   where m.team_id = p_team_id and m.rank = 'owner' and m.archived_at is null
     for update;

  v_is_owner := exists (
    select 1 from team_members m
     where m.team_id = p_team_id and m.person_id = my_person_id()
       and m.rank = 'owner' and m.archived_at is null
  );
  if not v_is_owner and not public.has_team_permission(p_team_id, 'promote_assistants') then
    raise exception 'Not authorized';
  end if;
  if p_rank is null or p_rank not in ('officer', 'assistant', 'raider') then
    raise exception 'A rank is Officer, Assistant or Raider';
  end if;

  select m.rank into v_old
    from team_members m
   where m.id = p_team_member_id and m.team_id = p_team_id and m.archived_at is null
     for update;
  if not found then
    raise exception 'That person is not on this team';
  end if;
  if v_old = 'owner' then
    raise exception 'That person is the Team Owner. A guild Owner or Admin changes the Team Owner.';
  end if;
  if (v_old = 'officer' or p_rank = 'officer') and not v_is_owner then
    raise exception 'Only the Team Owner makes someone an Officer or takes it away';
  end if;
  if v_old = p_rank then
    return;
  end if;

  update team_members set rank = p_rank where id = p_team_member_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Rank Changed', 'team_members', p_team_member_id,
          jsonb_build_object('from', v_old, 'to', p_rank));
end;
$$;

comment on function public.set_team_rank(integer, integer, text) is
  'Changes a current member''s team rank (#1651): the Team Owner to Officer, Assistant or Raider; anyone with promote_assistants between Raider and Assistant only. Never to or from Team Owner; change_team_owner() does that.';

revoke all on function public.set_team_rank(integer, integer, text) from public, anon;
grant execute on function public.set_team_rank(integer, integer, text) to authenticated;

create function public.team_owner_options(p_team_id integer)
returns table (team_member_id integer, display_name text, rank text, signed_in boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

comment on function public.team_owner_options(integer) is
  'A team''s current members, with a name to show, their rank and whether they have signed in, for picking a new Team Owner (#1651). For anyone with change_team_owner on the team''s guild.';

revoke all on function public.team_owner_options(integer) from public, anon;
grant execute on function public.team_owner_options(integer) to authenticated;

create function public.change_team_owner(p_team_id integer, p_team_member_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
  v_archived timestamptz;
  v_old_owner integer;
  v_old_rank text;
  v_signed_in boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select t.guild_id, t.archived_at into v_guild, v_archived from teams t where t.id = p_team_id;
  if not public.has_guild_permission(v_guild, 'change_team_owner') then
    raise exception 'Not authorized';
  end if;
  if v_archived is not null then
    raise exception 'That team is archived. Bring it back first.';
  end if;

  -- A team may have no owner, when its last team leader left.
  select m.id into v_old_owner
    from team_members m
   where m.team_id = p_team_id and m.rank = 'owner' and m.archived_at is null
     for update;

  select m.rank, pe.auth_user_id is not null into v_old_rank, v_signed_in
    from team_members m
    join people pe on pe.id = m.person_id
   where m.id = p_team_member_id and m.team_id = p_team_id and m.archived_at is null
     for update of m;
  if not found then
    raise exception 'That person is not on this team';
  end if;
  if v_old_rank = 'owner' then
    raise exception 'That person is already the Team Owner';
  end if;
  -- An owner nobody can sign in as would leave the team with no one to act
  -- for it, as transfer_guild_ownership() refuses for a guild.
  if not v_signed_in then
    raise exception 'That person has not signed in yet';
  end if;

  -- One statement, on purpose. Stepping down alone would fire
  -- team_members_pass_ownership at once, handing the team to any other team
  -- leader, and the new owner would then hit team_members_one_owner. In one
  -- statement that trigger waits until the end, and finds an owner. The
  -- subquery makes the old owner step down first, as the unique index needs.
  with stepped_down as (
    update team_members set rank = 'officer' where id = v_old_owner returning id
  )
  update team_members set rank = 'owner'
   where id = p_team_member_id and (select count(*) from stepped_down) >= 0;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Owner Changed', 'team_members', p_team_member_id,
          jsonb_build_object('from_team_member_id', v_old_owner, 'to_old_rank', v_old_rank));
end;
$$;

comment on function public.change_team_owner(integer, integer) is
  'Hands a team to one of its current members who has signed in (#1651), for anyone with change_team_owner on the team''s guild. The old Team Owner becomes an Officer.';

revoke all on function public.change_team_owner(integer, integer) from public, anon;
grant execute on function public.change_team_owner(integer, integer) to authenticated;
