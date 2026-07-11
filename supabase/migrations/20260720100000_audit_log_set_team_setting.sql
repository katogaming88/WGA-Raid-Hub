-- Audits every team_settings write, not just the admin dashboard's feature
-- flags (#232). set_team_setting is the single generic write path for
-- season config, the signup/BiS/M+ toggles, and now feature flags -- until
-- this, none of it left a trace in audit_log, site admin or team leader
-- alike.
--
-- write_audit_log() is SECURITY DEFINER and does its own officer/team_leader-
-- or-site-admin authorization check, so calling it from set_team_setting
-- (still SECURITY INVOKER, still gated by team_settings' own access rule) is
-- safe regardless of which one actually let the UPDATE through.
--
-- p_updates isn't a good audit detail on its own: the jsonb `||` merge is
-- shallow, so a single-flag toggle on the Feature Flags tab (js/admin.js)
-- has to resend the whole 7-key features object every time or it would wipe
-- out the other flags -- logging p_updates verbatim would show all 7 keys
-- on every save, hiding which one actually changed. Diffs old config
-- against the merged result instead, one level deep so a changed nested
-- object (features) reports only its changed sub-key(s); an unchanged
-- top-level key is dropped entirely, and a scalar top-level key (season
-- name, dates, etc.) logs its new value same as before. An empty diff (a
-- caller re-sending values that already match, e.g. clicking a flag back to
-- its current state) skips logging entirely rather than writing a no-op row.
create or replace function public.set_team_setting(p_team_id integer, p_updates jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_old_config jsonb;
  v_config jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_sub_key text;
  v_old_val jsonb;
  v_new_val jsonb;
  v_sub_diff jsonb;
begin
  select config into v_old_config from public.team_settings where team_id = p_team_id;

  update public.team_settings
  set config = config || p_updates
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  for v_key in select jsonb_object_keys(p_updates) loop
    v_old_val := v_old_config -> v_key;
    v_new_val := v_config -> v_key;
    if v_old_val is distinct from v_new_val then
      if jsonb_typeof(v_old_val) = 'object' and jsonb_typeof(v_new_val) = 'object' then
        v_sub_diff := '{}'::jsonb;
        for v_sub_key in select jsonb_object_keys(v_new_val) loop
          if (v_old_val -> v_sub_key) is distinct from (v_new_val -> v_sub_key) then
            v_sub_diff := v_sub_diff || jsonb_build_object(v_sub_key, v_new_val -> v_sub_key);
          end if;
        end loop;
        v_diff := v_diff || jsonb_build_object(v_key, v_sub_diff);
      else
        v_diff := v_diff || jsonb_build_object(v_key, v_new_val);
      end if;
    end if;
  end loop;

  if v_diff <> '{}'::jsonb then
    perform public.write_audit_log(p_team_id, 'team_setting_updated', 'team_settings', null, v_diff);
  end if;

  return v_config;
end;
$$;
