-- Capture the submitter's identity when signed in (#500).
--
-- Mirrors submit_self_received()'s auth.uid()-aware branch (#406): this
-- function must stay callable by anon (prospective recruits with no
-- Discord session yet), so it cannot require auth.uid() the way
-- claim_character() does -- it can only opportunistically record it when
-- present. This is the write half of #500's self-edit path; see
-- get_own_signup()/update_own_signup() (20260726104517) for the read/edit
-- half that relies on this column being set.
create or replace function public.submit_season_signup(
  p_team_id integer,
  p_name_realm text,
  p_class text,
  p_spec text,
  p_off_specs text default '',
  p_main_swap boolean default false,
  p_player_note text default null,
  p_swap_from_name_realm text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_class_spec_id integer;
  v_season text;
  v_signup_id integer;
  v_auth_user_id uuid;
begin
  select config into v_config from public.team_settings where team_id = p_team_id;
  if v_config is null or coalesce((v_config->>'signupsOpen')::boolean, false) is not true then
    raise exception 'signups are not open for this team';
  end if;
  v_season := v_config->>'activeSignupSeason';

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  if auth.uid() is not null then
    v_auth_user_id := auth.uid();
  end if;

  insert into public.season_signups (
    team_id, signup_name_realm, class_spec_id, off_specs, main_swap,
    swap_class_spec_id, player_note, season, status, swap_from_name_realm,
    auth_user_id
  ) values (
    p_team_id, p_name_realm,
    case when p_main_swap then null else v_class_spec_id end,
    nullif(p_off_specs, ''), p_main_swap,
    case when p_main_swap then v_class_spec_id else null end,
    nullif(p_player_note, ''), v_season, 'pending',
    case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end,
    v_auth_user_id
  ) returning id into v_signup_id;

  return v_signup_id;
end $$;

-- Grants restated (no-op safety net, create or replace doesn't touch existing grants).
revoke all on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  from public;
grant execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  to anon, authenticated;
