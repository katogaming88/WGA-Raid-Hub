-- Team audit rules (#1638, part of #1261): how strict the roster audit's
-- enchant and gem check is, and an optional weekly Great Vault minimum.
-- Saved on team_settings.config:
--
--   "enchantCheck": "strict" | "lenient" | "casual"
--   "vaultRule":    { "raid": 0-3, "dungeon": 0-3, "world": 0-3 } or null
--
-- strict: every enchant and gem must be the highest rank. lenient: highest
-- rank only on those giving primary or secondary stats; tertiary ones
-- (Leech, Avoidance, Speed) can be any rank. casual: any rank. In all three
-- they must be from the current expansion (season_enchants, season_gems).
-- vaultRule is the fewest slots each vault row must have filled that week;
-- a 0 means no minimum on that row, and all three 0 is stored as null (no
-- rule), so the audit shows a vault rule only once one is set up.
--
-- A team that never saved reads as lenient with no vault rule; readers
-- coalesce, so nothing is backfilled.
--
-- team_settings' own write rule is team-leader-only, and this is the team's
-- officers' call, so it gets its own SECURITY DEFINER function like
-- set_loot_responses(): whoever has promote_assistants on the team's grid
-- (Officer by default, which is what opens Settings in the new app; the Team
-- Owner always), or a site admin. A guild officer counts only on a team they
-- hold a rank on (Kat, 2026-10-28: guild officers read every team, write
-- only their own). No table or existing data changes.
create or replace function public.set_team_audit_rules(
  p_team_id integer,
  p_enchant_check text,
  p_vault_rule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.set_team_audit_rules(integer, text, jsonb) from public, anon;
grant execute on function public.set_team_audit_rules(integer, text, jsonb) to authenticated;
