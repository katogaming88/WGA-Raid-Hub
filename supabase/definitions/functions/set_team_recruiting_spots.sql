-- Function public.set_team_recruiting_spots: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_recruiting_spots(p_team_id integer, p_spots jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_spot jsonb;
  v_n integer := 0;
  v_spec integer;
  v_role text;
  v_spec_role text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_spots) is distinct from 'array' then
    raise exception 'Spots must be a list';
  end if;
  if jsonb_array_length(p_spots) > 40 then
    raise exception 'A team has at most 40 open spots';
  end if;
  perform 1 from team_recruiting r where r.team_id = p_team_id for update;
  if not found then
    raise exception 'That team does not exist';
  end if;

  v_old := team_recruiting_spot_list(p_team_id);
  delete from team_recruiting_spots where team_id = p_team_id;

  for v_spot in select value from jsonb_array_elements(p_spots)
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_spot) is distinct from 'object' then
      raise exception 'Each spot must be an object';
    end if;
    v_spec := (v_spot ->> 'class_spec_id')::integer;
    v_role := v_spot ->> 'role';
    if v_spec is not null then
      select case cs.role when 'Tank' then 'tank' when 'Heal' then 'healer'
                          when 'Melee' then 'melee' when 'Ranged' then 'ranged' end
        into v_spec_role
        from classes_specs cs where cs.id = v_spec;
      if v_spec_role is null then
        raise exception 'That is not a spec';
      end if;
      if v_role is not null and v_role <> v_spec_role then
        raise exception 'That spec is a % spec', v_spec_role;
      end if;
      v_role := v_spec_role;
    elsif v_role is null or v_role not in ('tank', 'healer', 'melee', 'ranged') then
      raise exception 'A spot without a spec needs tank, healer, melee or ranged';
    end if;

    begin
      insert into team_recruiting_spots (team_id, role, class_spec_id, priority, sort_order)
      values (p_team_id, v_role, v_spec, v_spot ->> 'priority', v_n);
    exception when unique_violation then
      raise exception 'That spot is on the list twice';
    end;
  end loop;

  if team_recruiting_spot_list(p_team_id) = v_old then
    return;
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Recruiting Spots Changed', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', team_recruiting_spot_list(p_team_id)));
end;
$function$;
