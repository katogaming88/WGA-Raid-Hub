-- Function public.set_team_discord_after_raid: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_discord_after_raid(p_team_id integer, p_after_raid text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_after_raid is null or p_after_raid not in ('finish', 'delete') then
    raise exception 'Pick finish or delete';
  end if;

  select c.after_raid into v_old from team_discord_config c where c.team_id = p_team_id for update;
  if not found then
    raise exception 'Pick the team''s Discord server first';
  end if;
  if v_old = p_after_raid then
    return;
  end if;

  update team_discord_config set after_raid = p_after_raid, updated_at = now() where team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord After Raid Set', 'teams', p_team_id,
          jsonb_build_object('from', v_old, 'to', p_after_raid));
end;
$function$;
