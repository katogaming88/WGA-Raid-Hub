-- Function public.set_boss_role_targets: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_boss_role_targets(p_team_id integer, p_encounter_id integer, p_tanks integer DEFAULT NULL::integer, p_healers integer DEFAULT NULL::integer, p_melee integer DEFAULT NULL::integer, p_ranged integer DEFAULT NULL::integer)
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

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'There is no such boss.';
  end if;

  if p_tanks not between 0 and 30 or p_healers not between 0 and 30
     or p_melee not between 0 and 30 or p_ranged not between 0 and 30 then
    raise exception 'A boss''s targets have to be between 0 and 30.';
  end if;

  if num_nonnulls(p_tanks, p_healers, p_melee, p_ranged) = 0 then
    delete from team_boss_role_targets where team_id = p_team_id and encounter_id = p_encounter_id;
  else
    insert into team_boss_role_targets (team_id, encounter_id, tanks, healers, melee, ranged, updated_at)
    values (p_team_id, p_encounter_id, p_tanks, p_healers, p_melee, p_ranged, now())
    on conflict (team_id, encounter_id) do update
      set tanks = excluded.tanks, healers = excluded.healers, melee = excluded.melee,
          ranged = excluded.ranged, updated_at = excluded.updated_at;
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Role Targets',
    'team_boss_role_targets',
    null,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'tanks', p_tanks, 'healers', p_healers, 'melee', p_melee, 'ranged', p_ranged
    )
  );
end;
$function$;
