-- Require a Discord session to submit a signup -- no more anonymous entries.
--
-- submit_season_signup previously had to stay anon-callable (see
-- 20260726104516's comment) for prospective recruits with no Discord session
-- yet. That's reversed now: every signup must be tied to a real
-- auth_user_id, so the function raises when auth.uid() is null instead of
-- inserting with a null auth_user_id, and anon loses execute entirely.
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
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Not signed in';
  end if;

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

revoke all on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  from public;
revoke execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  from anon;
grant execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  to authenticated;
