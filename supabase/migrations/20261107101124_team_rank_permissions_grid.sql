-- #1653: the team's rank permissions grid. The Team Owner saves their changes
-- through set_team_rank_permissions(), the first write to team_rank_permissions
-- from outside a migration or the seeding trigger. It mirrors
-- set_guild_rank_permissions() (#1652).
--
-- "Edit own wishlist" is the one switch nothing enforced yet. The two
-- wishlist triggers now refuse a team member whose rank has it off, so a Team
-- Owner can lock picks before a raid. It holds even where a character has
-- wishlist_allowed, which only reopens a closed season.

-- p_changes is a list of {"rank": "officer", "permission": "edit_roster", "on": true}.
-- All of a save applies or none of it, and a permission it doesn't name stays as
-- it is, so the page can leave out what it doesn't show.
create function public.set_team_rank_permissions(p_team_id integer, p_changes jsonb)
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
  perform 1 from team_members m
   where m.team_id = p_team_id and m.person_id = my_person_id()
     and m.rank = 'owner' and m.archived_at is null
     for update;
  if not found then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Changes must be a list';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_rank := v_change ->> 'rank';
    v_permission := v_change ->> 'permission';
    if v_rank is null or v_rank not in ('raider', 'assistant', 'officer') then
      raise exception 'A rank is Officer, Assistant or Raider';
    end if;
    if not exists (select 1 from rank_permissions k
                    where k.permission = v_permission and k.scope = 'team') then
      raise exception 'That is not a team permission';
    end if;
    if jsonb_typeof(v_change -> 'on') is distinct from 'boolean' then
      raise exception 'A change must say on or off';
    end if;
    v_on := (v_change ->> 'on')::boolean;

    if v_on then
      insert into team_rank_permissions (team_id, rank, permission)
      values (p_team_id, v_rank, v_permission)
      on conflict do nothing;
    else
      delete from team_rank_permissions
       where team_id = p_team_id and rank = v_rank and permission = v_permission;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_applied := v_applied || jsonb_build_object(v_rank || ' ' || v_permission, v_on);
    end if;
  end loop;

  -- Nothing actually changed: nothing to log.
  if v_applied = '{}'::jsonb then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Team Permissions Changed', 'teams', p_team_id, v_applied);
end;
$$;

comment on function public.set_team_rank_permissions(integer, jsonb) is
  'The Team Owner switches permissions on or off for Raider, Assistant and Officer (#1653). All of a save applies or none of it, and permissions it does not name stay as they are. Staff have no override.';

revoke all on function public.set_team_rank_permissions(integer, jsonb) from public, anon;
grant execute on function public.set_team_rank_permissions(integer, jsonb) to authenticated;

create or replace function public.restrict_item_preferences_to_open_wishlist()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_row public.item_preferences;
begin
  if current_user = 'authenticated' then
    -- An update is checked on both sides, so a row can neither be edited in
    -- a closed season nor moved into one; once when neither side moves.
    foreach v_row in array case
        when tg_op = 'INSERT' then array[new]
        when tg_op = 'DELETE' then array[old]
        when (new.player_id, new.team_id, new.season) is not distinct from (old.player_id, old.team_id, old.season)
          then array[old]
        else array[old, new]
      end
    loop
      if public.is_own_player(v_row.player_id) then
        -- The Team Owner's lock, from the team's grid (#1653).
        if not public.has_team_permission(v_row.team_id, 'edit_own_wishlist') then
          raise exception 'your rank cannot edit its wishlist on this team';
        end if;
        if not exists (
             select 1 from public.team_seasons ts
             where ts.team_id = v_row.team_id and ts.season_code = v_row.season and ts.wishlist_open
           )
           and not exists (
             select 1 from public.players p
             where p.id = v_row.player_id and p.wishlist_allowed
           )
        then
          raise exception 'wishlist editing is not open for that season on this team';
        end if;
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- A signup's wishlist: the same lock, for someone already on the team. A
-- signer with no place on the team has no rank to ask.
create or replace function public.restrict_signup_item_preferences_to_open_wishlist()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_signup_id integer;
  v_team_id integer;
begin
  if current_user = 'authenticated' then
    foreach v_signup_id in array case
        when tg_op = 'INSERT' then array[new.signup_id]
        when tg_op = 'DELETE' then array[old.signup_id]
        else array[old.signup_id, new.signup_id]
      end
    loop
      select s.team_id into v_team_id from public.season_signups s where s.id = v_signup_id;
      if exists (select 1 from public.team_members m
                  where m.team_id = v_team_id and m.person_id = public.my_person_id()
                    and m.archived_at is null)
         and not public.has_team_permission(v_team_id, 'edit_own_wishlist') then
        raise exception 'your rank cannot edit its wishlist on this team';
      end if;
      if not public.signup_wishlist_open(v_signup_id) then
        raise exception 'wishlist editing is not open for that season on this team';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
