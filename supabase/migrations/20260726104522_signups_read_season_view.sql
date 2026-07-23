-- Repoint signup season resolution at team_settings.config.seasonView
-- instead of activeSignupSeason (#549): seasonView is a single nullable
-- setting an officer points at whichever season they're actively
-- planning/prepping, falling back to the live seasonName when unset. It
-- replaces activeSignupSeason as its own free-typed field entirely --
-- signups now read/write the same setting everything else season-scoped
-- reads (Priority tab, BiS grid, Wishlist, all client-side via
-- resolveSeasonView() in js/common.js).
--
-- Three objects read activeSignupSeason today; all three move to
-- coalesce(seasonView, seasonName), same fallback resolveSeasonView() uses
-- client-side. Bodies otherwise unchanged from their current definitions.

-- submit_season_signup (currently defined in
-- 20260726104516_submit_season_signup_auth_user_id.sql).
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
  v_season := coalesce(v_config->>'seasonView', v_config->>'seasonName');

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

-- get_own_signup (currently defined in 20260726104517_own_signup_read_and_edit.sql).
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

  select coalesce(config->>'seasonView', config->>'seasonName') into v_season
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

-- incoming_roster view (currently defined in
-- 20260726104514_incoming_roster_public_view.sql).
create or replace view public.incoming_roster
as
select s.id as signup_id,
       s.team_id,
       s.signup_name_realm,
       cs.class,
       cs.spec,
       cs.role
from public.season_signups s
join public.team_settings ts
  on ts.team_id = s.team_id
left join public.classes_specs cs
  on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
where s.status = 'approved'
  and s.approved_player_id is null
  and s.season = coalesce(ts.config->>'seasonView', ts.config->>'seasonName');

grant select on public.incoming_roster to anon, authenticated;
