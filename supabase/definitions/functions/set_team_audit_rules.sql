-- Function public.set_team_audit_rules: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_audit_rules(p_team_id integer, p_enchant_check text, p_vault_rule jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb;
  v_rule jsonb := null;
  v_row text;
  v_slots jsonb;
begin
  if not (
    public.has_team_permission(p_team_id, 'promote_assistants')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_enchant_check is null or p_enchant_check not in ('strict', 'lenient', 'casual') then
    raise exception 'The enchant and gem check must be strict, lenient or casual.';
  end if;

  if p_vault_rule is not null and jsonb_typeof(p_vault_rule) <> 'null' then
    if jsonb_typeof(p_vault_rule) <> 'object' then
      raise exception 'The vault rule must give raid, dungeon and world slots.';
    end if;
    v_rule := '{}'::jsonb;
    foreach v_row in array array['raid', 'dungeon', 'world'] loop
      v_slots := coalesce(nullif(p_vault_rule -> v_row, 'null'::jsonb), '0'::jsonb);
      if jsonb_typeof(v_slots) <> 'number' or v_slots::numeric not in (0, 1, 2, 3) then
        raise exception 'Vault % slots must be 0 to 3.', v_row;
      end if;
      v_rule := v_rule || jsonb_build_object(v_row, v_slots::integer);
    end loop;
    if v_rule = '{"raid": 0, "dungeon": 0, "world": 0}'::jsonb then
      v_rule := null;
    end if;
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('enchantCheck', p_enchant_check, 'vaultRule', v_rule)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Audit Rules Saved',
    'team_settings',
    null,
    jsonb_build_object('enchantCheck', p_enchant_check, 'vaultRule', v_rule)
  );

  return v_config;
end;
$function$;
