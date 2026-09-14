-- Function public.set_team_setting: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_setting(p_team_id integer, p_updates jsonb, p_skip_audit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  if not p_skip_audit then
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
  end if;

  return v_config;
end;
$function$;
