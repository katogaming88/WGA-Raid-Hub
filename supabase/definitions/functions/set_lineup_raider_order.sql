-- Function public.set_lineup_raider_order: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_lineup_raider_order(p_team_id integer, p_role text, p_player_ids integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from teams where id = p_team_id) then
    raise exception 'There is no such team.';
  end if;

  if p_role is null or p_role not in (select distinct role from classes_specs) then
    raise exception 'There is no such role.';
  end if;

  p_player_ids := coalesce(p_player_ids, '{}');

  if (select count(distinct x) from unnest(p_player_ids) x) <> cardinality(p_player_ids) then
    raise exception 'A raider can be listed only once.';
  end if;

  -- Only this team's raiders, and only in their own role's section.
  if exists (
    select 1
    from unnest(p_player_ids) x
    where not exists (
      select 1
      from players p
      join classes_specs cs on cs.id = p.class_spec_id
      where p.id = x and p.team_id = p_team_id and p.archived_at is null and cs.role = p_role
    )
  ) then
    raise exception 'Every raider has to be on this team, on the roster and in the % section.', p_role;
  end if;

  -- Two officers moving at once: the later move wins, whole.
  perform pg_advisory_xact_lock(hashtext('raider_order'), p_team_id);

  -- The section's old rows: those placed in it, and any raider now in it.
  delete from team_raider_order o
  where o.team_id = p_team_id
    and (o.role = p_role
         or exists (
           select 1 from players p join classes_specs cs on cs.id = p.class_spec_id
           where p.id = o.player_id and cs.role = p_role));

  insert into team_raider_order (team_id, player_id, role, position)
  select p_team_id, o.player_id, p_role, o.ord
  from unnest(p_player_ids) with ordinality as o(player_id, ord);

  perform public.write_audit_log(
    p_team_id,
    case when cardinality(p_player_ids) = 0 then 'Reset Raider Order' else 'Set Raider Order' end,
    'team_raider_order',
    null,
    jsonb_build_object(
      'role', p_role,
      'raiders', (select coalesce(jsonb_agg(p.name_realm order by o.ord), '[]'::jsonb)
                    from unnest(p_player_ids) with ordinality as o(player_id, ord)
                    join players p on p.id = o.player_id)
    )
  );
end;
$function$;
