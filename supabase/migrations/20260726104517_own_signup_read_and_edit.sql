-- Raider self-service read and edit of their own season signup (#500).
--
-- Both require auth.uid() (unlike submit_season_signup, which must stay
-- anon-callable): a raider can only read/edit a signup once auth_user_id was
-- captured at submission time, which only happens when they were signed in
-- then (see 20260726104515's comment on that limitation).
--
-- get_own_signup deliberately does NOT expose signup_officer_note or
-- reviewed_by (an internal team_members id) -- same officer-eyes-only rule
-- as #499. A definer function with a fixed RETURN QUERY column list means no
-- future frontend change can leak that column, unlike a bare column-list
-- view (see #503's critique of incoming_roster's shape). Scoped to the
-- caller's currently active signup season, not every signup they've ever
-- submitted, so revisiting Sign Up after a past season's signup was already
-- promoted gets a fresh form, not a stale locked summary.
create or replace function public.get_own_signup(p_team_id integer)
returns table(
  id integer,
  signup_name_realm text,
  class text,
  spec text,
  off_specs text,
  main_swap boolean,
  swap_class text,
  swap_spec text,
  swap_from_name_realm text,
  player_note text,
  status text,
  season text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_season text;
begin
  if v_uid is null then
    return;
  end if;

  select config->>'activeSignupSeason' into v_season
  from public.team_settings where team_id = p_team_id;

  return query
  select s.id, s.signup_name_realm,
         cs_main.class, cs_main.spec,
         s.off_specs, s.main_swap,
         cs_swap.class, cs_swap.spec, s.swap_from_name_realm,
         s.player_note, s.status, s.season, s.submitted_at
  from public.season_signups s
  left join public.classes_specs cs_main on cs_main.id = s.class_spec_id
  left join public.classes_specs cs_swap on cs_swap.id = s.swap_class_spec_id
  where s.team_id = p_team_id
    and s.auth_user_id = v_uid
    and s.season is not distinct from v_season
  order by s.submitted_at desc
  limit 1;
end $$;

revoke all on function public.get_own_signup(integer) from public;
revoke execute on function public.get_own_signup(integer) from anon;
grant execute on function public.get_own_signup(integer) to authenticated;

-- update_own_signup mirrors submit_season_signup's real 8-param field shape
-- (minus p_team_id, plus p_signup_id identifying which row) -- including
-- p_swap_from_name_realm, so an edit can redo the exact claim-timing
-- computation the create path does, which is the direct fix for incident #1
-- (the race where the claim resolves after the original submission).
--
-- Ownership guard rides on the write itself (auth_user_id = auth.uid() in
-- the UPDATE's own WHERE), same TOCTOU-safe idiom as claim_character()'s
-- "update ... where team_member_id is null; if not found then raise" -- a
-- signup that flips to added mid-request (an officer's add_signup_to_roster
-- racing this call) cannot be edited even if an earlier diagnostic read
-- still saw it as approved.
--
-- Status/reviewed_* transition matches decision 3: pending stays pending; an
-- approved-but-not-yet-promoted signup reverts to pending and
-- reviewed_at/reviewed_by/signup_officer_note are all cleared for a clean
-- slate (symmetric with tab-signups.js's reviewSignup(), the only other
-- writer of those three columns). added is locked outright; rejected is
-- also locked (not in decision 3's editable set).
create or replace function public.update_own_signup(
  p_signup_id integer,
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
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_approved_player_id integer;
  v_class_spec_id integer;
  v_updated_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Diagnostic-only pre-check, purely for a clearer error message; the real
  -- authorization guard is the UPDATE's WHERE clause below.
  select auth_user_id, status, approved_player_id
    into v_owner, v_status, v_approved_player_id
  from public.season_signups where id = p_signup_id;

  if v_owner is null or v_owner is distinct from v_uid then
    raise exception 'Signup not found';
  end if;
  if v_status = 'added' then
    raise exception 'This signup has already been added to the roster and can no longer be edited';
  end if;
  if v_status = 'rejected' then
    raise exception 'This signup was not approved and can no longer be edited';
  end if;
  if not (v_status = 'pending' or (v_status = 'approved' and v_approved_player_id is null)) then
    raise exception 'This signup can no longer be edited';
  end if;

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  update public.season_signups s set
    signup_name_realm = p_name_realm,
    class_spec_id = case when p_main_swap then null else v_class_spec_id end,
    off_specs = nullif(p_off_specs, ''),
    main_swap = p_main_swap,
    swap_class_spec_id = case when p_main_swap then v_class_spec_id else null end,
    swap_from_name_realm = case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end,
    player_note = nullif(p_player_note, ''),
    status = case when s.status = 'approved' then 'pending' else s.status end,
    reviewed_at = case when s.status = 'approved' then null else s.reviewed_at end,
    reviewed_by = case when s.status = 'approved' then null else s.reviewed_by end,
    signup_officer_note = case when s.status = 'approved' then null else s.signup_officer_note end
  where s.id = p_signup_id
    and s.auth_user_id = v_uid
    and (s.status = 'pending' or (s.status = 'approved' and s.approved_player_id is null))
  returning s.id into v_updated_id;

  if not found then
    raise exception 'This signup can no longer be edited';
  end if;

  return v_updated_id;
end $$;

revoke all on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) from public;
revoke execute on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) from anon;
grant execute on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) to authenticated;
