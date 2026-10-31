-- Function public.remove_team_discord_signup_sheet: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.remove_team_discord_signup_sheet(p_team_id integer, p_sheet_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_discord_signup_sheets;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'change_discord_settings') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- The team's lock, as the save takes, so a save in flight finishes first.
  perform 1 from team_discord_config c where c.team_id = p_team_id for update;
  delete from team_discord_signup_sheets s
   where s.id = p_sheet_id and s.team_id = p_team_id
  returning * into v_old;
  if not found then
    raise exception 'That sheet is not on this team';
  end if;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Discord Signup Sheet Removed', 'team_discord_signup_sheets', p_sheet_id,
          jsonb_build_object('channel_id', v_old.channel_id, 'raid_days', v_old.raid_days,
                             'keep_raids_posted', v_old.keep_raids_posted, 'hours_before', v_old.hours_before,
                             'ping_role_id', v_old.ping_role_id));
end;
$function$;
