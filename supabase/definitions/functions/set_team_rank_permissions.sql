-- Function public.set_team_rank_permissions: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_rank_permissions(p_team_id integer, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
