-- #1652: the guild's rank permissions grid. The Owner saves their changes
-- through set_guild_rank_permissions(), the first write to guild_rank_permissions
-- from outside a migration or the seeding trigger.
--
-- has_guild_permission() also stops stacking Member under the higher ranks. It
-- counted anyone on a team as a Member as well as their own rank, so ticking
-- Member would have given that permission to an Admin whose own box was off.
-- A person holds one guild rank (#1517), so Member now answers only for someone
-- with no higher rank in the guild. Member holds nothing by default, so nobody's
-- access changes today.
--
-- Member also comes only from being on a team now, never from a guild_ranks row.
-- The current site's Revoke Guild Officer leaves a 'member' row behind, which
-- would keep Member's permissions for someone who has left every team.

create or replace function public.has_guild_permission(p_guild_id integer, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with ranks as (
    select g.rank
      from guild_ranks g
     where g.guild_id = p_guild_id and g.person_id = my_person_id() and g.rank <> 'member'
    union all
    select 'member'
      from team_members m
      join teams t on t.id = m.team_id
     where t.guild_id = p_guild_id and m.person_id = my_person_id() and m.archived_at is null
       and not exists (select 1 from guild_ranks g
                        where g.guild_id = p_guild_id and g.person_id = my_person_id()
                          and g.rank <> 'member')
  )
  select exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'guild')
     and (exists (select 1 from ranks r
                   where r.rank = 'owner'
                      or exists (select 1 from guild_rank_permissions p
                                  where p.guild_id = p_guild_id and p.rank = r.rank
                                    and p.permission = p_permission))
          or (p_permission in ('record_boe', 'pay_any_boe')
              and exists (select 1 from guild_grants g
                           where g.guild_id = p_guild_id and g.person_id = my_person_id()
                             and g.grant_type = 'boe_manager')));
$$;

-- p_changes is a list of {"rank": "admin", "permission": "record_boe", "on": true}.
-- All of a save applies or none of it, and a permission it doesn't name stays as
-- it is, so the page can leave out what it doesn't show.
create function public.set_guild_rank_permissions(p_guild_id integer, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_change jsonb;
  v_rank text;
  v_permission text;
  v_on boolean;
  v_rows integer;
  v_applied jsonb := '{}'::jsonb;
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
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Changes must be a list';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_rank := v_change ->> 'rank';
    v_permission := v_change ->> 'permission';
    if v_rank is null or v_rank not in ('member', 'team_lead', 'admin') then
      raise exception 'A rank is Admin, Team Lead or Member';
    end if;
    if not exists (select 1 from rank_permissions k
                    where k.permission = v_permission and k.scope = 'guild') then
      raise exception 'That is not a guild permission';
    end if;
    if jsonb_typeof(v_change -> 'on') is distinct from 'boolean' then
      raise exception 'A change must say on or off';
    end if;
    v_on := (v_change ->> 'on')::boolean;

    if v_on then
      insert into guild_rank_permissions (guild_id, rank, permission)
      values (p_guild_id, v_rank, v_permission)
      on conflict do nothing;
    else
      delete from guild_rank_permissions
       where guild_id = p_guild_id and rank = v_rank and permission = v_permission;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      -- One flat key per change: every audit view spells these out, as
      -- "Admin record boe: Off", where a list would show only as a count.
      v_applied := v_applied || jsonb_build_object(v_rank || ' ' || v_permission, v_on);
    end if;
  end loop;

  -- Nothing actually changed: nothing to log.
  if v_applied = '{}'::jsonb then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Permissions Changed', 'guilds', p_guild_id, v_applied);
end;
$$;

comment on function public.set_guild_rank_permissions(integer, jsonb) is
  'The guild Owner switches permissions on or off for Member, Team Lead and Admin (#1652). All of a save applies or none of it, and permissions it does not name stay as they are. Staff have no override.';

revoke all on function public.set_guild_rank_permissions(integer, jsonb) from public, anon;
grant execute on function public.set_guild_rank_permissions(integer, jsonb) to authenticated;
