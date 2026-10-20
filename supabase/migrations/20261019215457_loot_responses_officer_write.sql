-- What gets counted as loot received (#1561): officers list their
-- RCLootCouncil response buttons, as spelled in game, and say what each one
-- counts as. Saved on team_settings.config -> 'lootResponses':
--
--   { "buttons": [{ "text": "Upgrade", "countsAs": "main" }, ...],
--     "groups":  [{ "name": "Armor Token",
--                   "buttons": [{ "text": "2/4 Set", "countsAs": "main" }] }] }
--
-- countsAs is main (counts toward loot counts and priority), off (shown, not
-- counted), none (not handed out: disenchant, personal loot) or hidden (not
-- counted and not shown to raiders). Buttons are in the in-game order,
-- highest priority first. A response the list does not name counts as
-- hidden (Kat, 2026-10-19): leaving it off is how an officer hides it.
--
-- team_settings' own write rule is team-leader-only, and this list is an
-- officer's job (the officers run the imports), so it gets its own SECURITY
-- DEFINER function, same shape as set_team_officer_bios(): officer or team
-- leader of that team, or a site admin. Unlike the bios, guild officers are
-- left out, as they are from loot import.
--
-- Nothing reads the list yet; the readers move over in later parts of #1561,
-- and a team with no list keeps today's rules. No table or existing data
-- changes: this adds one function.
create or replace function public.set_loot_responses(p_team_id integer, p_responses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_group jsonb;
  v_button jsonb;
  v_count integer := 0;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if jsonb_typeof(p_responses) is distinct from 'object'
    or jsonb_typeof(p_responses -> 'buttons') is distinct from 'array'
    or jsonb_typeof(p_responses -> 'groups') is distinct from 'array'
  then
    raise exception 'The button list must have buttons and groups.';
  end if;

  for v_group in select g from jsonb_array_elements(p_responses -> 'groups') as g loop
    if jsonb_typeof(v_group -> 'name') is distinct from 'string'
      or length(btrim(v_group ->> 'name')) not between 1 and 60
    then
      raise exception 'Every button group needs a name.';
    end if;
    if jsonb_typeof(v_group -> 'buttons') is distinct from 'array' then
      raise exception 'Button group "%" needs a list of buttons.', v_group ->> 'name';
    end if;
  end loop;

  -- The normal buttons and every group's buttons, checked alike.
  for v_button in
    select b from jsonb_array_elements(p_responses -> 'buttons') as b
    union all
    select b
    from jsonb_array_elements(p_responses -> 'groups') as g,
      jsonb_array_elements(g -> 'buttons') as b
  loop
    if jsonb_typeof(v_button -> 'text') is distinct from 'string'
      or length(btrim(v_button ->> 'text')) not between 1 and 100
    then
      raise exception 'Every button needs its text, as spelled in game.';
    end if;
    if (v_button ->> 'countsAs') is null
      or (v_button ->> 'countsAs') not in ('main', 'off', 'none', 'hidden')
    then
      raise exception 'Button "%" needs what it counts as.', v_button ->> 'text';
    end if;
    v_count := v_count + 1;
  end loop;

  update public.team_settings
  set config = config || jsonb_build_object('lootResponses', p_responses)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Loot Responses Saved',
    'team_settings',
    null,
    jsonb_build_object('buttons', v_count, 'groups', jsonb_array_length(p_responses -> 'groups'))
  );

  return v_config;
end;
$$;

revoke all on function public.set_loot_responses(integer, jsonb) from public;
revoke execute on function public.set_loot_responses(integer, jsonb) from anon;
grant execute on function public.set_loot_responses(integer, jsonb) to authenticated;
