-- Audits every team_settings write, not just the admin dashboard's feature
-- flags (#232). set_team_setting is the single generic write path for
-- season config, the signup/BiS/M+ toggles, and now feature flags -- until
-- this, none of it left a trace in audit_log, site admin or team leader
-- alike.
--
-- write_audit_log() is SECURITY DEFINER and does its own officer/team_leader-
-- or-site-admin authorization check, so calling it from set_team_setting
-- (still SECURITY INVOKER, still gated by team_settings' own access rule) is
-- safe regardless of which one actually let the UPDATE through. Action name
-- and detail stay generic ('team_setting_updated', detail = p_updates)
-- since this function has no idea which semantic field(s) it was called for
-- -- the raw jsonb of what changed is more useful here than a guessed label.
create or replace function public.set_team_setting(p_team_id integer, p_updates jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
begin
  update public.team_settings
  set config = config || p_updates
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(p_team_id, 'team_setting_updated', 'team_settings', null, p_updates);

  return v_config;
end;
$$;
