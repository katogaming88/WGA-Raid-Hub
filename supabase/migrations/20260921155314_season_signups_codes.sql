-- #934: season_signups.season holds the tier code, and the signup season is
-- the team_seasons row.
--
-- Until now the column held display names (Midnight Season 2) referencing
-- seasons(display_name), and which tier a team took signups for was
-- activeSignupSeason on team_settings.config, a name an officer typed on the
-- Season tab. Since #939 the switch itself is a team_seasons row per team and
-- tier, and submit_season_signup() found the row by the name the key held.
-- Decision 13 on #1189 (2026-09-20) made the season app-wide and left a team
-- its two switches per tier and nothing else, so the key goes: a team's
-- signup seasons are its rows with signups_open, the raider picks the tier
-- (p_season, a seasons.code), and the three signup functions and the view
-- read the row. Third of the conversions #932 left for #933 to #938.
--
-- The named rows convert through seasons; a row with no season takes the
-- tier current on the day it was submitted, the rule #937 used for
-- boe_items (production, 2026-09-21: 78 named rows, one null, team 3's added
-- signup of 2026-07-12, which lands on MID1). The column stays nullable, as
-- #937 left boe_items.season: the fixtures insert without one, and a row
-- submitted before the first tier has no tier to take.
--
-- submit_season_signup() and get_own_signup() change signature, so the old
-- definitions are dropped first: create or replace with an added parameter
-- would leave both, and PostgREST refuses an rpc() call it cannot resolve to
-- one candidate. Passed as null, p_season means the team's one open tier:
-- a merge pushes this file before it publishes the site (#1083), so a
-- browser on the old bundle calls both functions without a tier for up to
-- ten minutes. That browser's Sign Up item, guild cards and officer toggle
-- read closed for the same window, since the key they read is gone.
--
-- update_own_signup() keeps its signature. An added row stays editable while
-- the team's row for its tier has signups_open, which is what the 2026-08-07
-- change meant by "while signups for this season are still open": the two
-- were the same fact by argument then, and are the same row now.
--
-- The three keys leave team_settings.config: activeSignupSeason, read by
-- nothing after this file, and signupsOpen and wishlistOpen, read by nothing
-- since #939 and left for this file to remove.

-- The column: names to codes, the null row to its day's tier, the key to code.
update public.season_signups s
set season = z.code
from public.seasons z
where z.display_name = s.season;

update public.season_signups
set season = public.current_season((submitted_at at time zone 'America/New_York')::date)
where season is null;

alter table public.season_signups drop constraint season_signups_season_fkey;
alter table public.season_signups
  add constraint season_signups_season_fkey foreign key (season) references public.seasons(code);

-- The stamp and the gate. Body otherwise as 20260921135215 left it.
drop function if exists public.submit_season_signup(integer, text, text, text, text, boolean, text, text);

create function public.submit_season_signup(
  p_team_id integer,
  p_name_realm text,
  p_class text,
  p_spec text,
  p_off_specs text default '',
  p_main_swap boolean default false,
  p_player_note text default null,
  p_swap_from_name_realm text default null,
  p_season text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_spec_id integer;
  v_season text;
  v_open_count integer;
  v_signup_id integer;
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Not signed in';
  end if;

  if p_season is null then
    -- The deploy window's case: a bundle that names no tier gets the team's
    -- one open tier, and a team with several open needs the pick.
    select count(*), min(ts.season_code) into v_open_count, v_season
    from public.team_seasons ts
    where ts.team_id = p_team_id and ts.signups_open;
    if v_open_count > 1 then
      raise exception 'more than one season is open for this team; pick one';
    end if;
    if v_open_count = 0 then
      raise exception 'signups are not open for this team';
    end if;
  else
    v_season := p_season;
    if not exists (
      select 1 from public.team_seasons ts
      where ts.team_id = p_team_id and ts.season_code = p_season and ts.signups_open
    ) then
      raise exception 'signups are not open for that season on this team';
    end if;
  end if;

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

revoke all on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text, text) to authenticated;

-- The raider's own row for the tier asked; with no tier, the latest across
-- the tiers the team has open. Body otherwise as 20260812045902 left it.
drop function if exists public.get_own_signup(integer);

create function public.get_own_signup(p_team_id integer, p_season text default null)
returns table (
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
begin
  if v_uid is null then
    return;
  end if;

  return query
  select s.id,
         coalesce(live.name_realm, s.signup_name_realm),
         coalesce(cs_live.class, cs_main.class),
         coalesce(cs_live.spec, cs_main.spec),
         s.off_specs, s.main_swap,
         cs_swap.class, cs_swap.spec, s.swap_from_name_realm,
         s.player_note, s.status, s.season, s.submitted_at
  from public.season_signups s
  left join public.classes_specs cs_main on cs_main.id = s.class_spec_id
  left join public.classes_specs cs_swap on cs_swap.id = s.swap_class_spec_id
  left join public.players live on live.id = s.approved_player_id
  left join public.classes_specs cs_live on cs_live.id = live.class_spec_id
  where s.team_id = p_team_id
    and s.auth_user_id = v_uid
    and (
      (p_season is not null and s.season = p_season)
      or (p_season is null and exists (
        select 1 from public.team_seasons ts
        where ts.team_id = s.team_id and ts.season_code = s.season and ts.signups_open
      ))
    )
  order by s.submitted_at desc
  limit 1;
end $$;

revoke all on function public.get_own_signup(integer, text) from public, anon;
grant execute on function public.get_own_signup(integer, text) to authenticated;

-- The added-row gate reads the row's own tier. Body otherwise as
-- 20260812045902 left it.
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
  v_team_id integer;
  v_row_season text;
  v_class_spec_id integer;
  v_updated_id integer;
  v_old_off_specs text;
  v_old_main_swap boolean;
  v_old_swap_from_name_realm text;
  v_old_player_note text;
  v_current_name_realm text;
  v_current_class_spec_id integer;
  v_live_name_realm text;
  v_live_class_spec_id integer;
  v_new_class_spec_id integer;
  v_new_swap_class_spec_id integer;
  v_new_swap_from_name_realm text;
  v_no_change boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Diagnostic-only pre-check, purely for a clearer error message; the real
  -- authorization guard is the UPDATE's WHERE clause below. Also doubles as
  -- the "before" snapshot for the no-change comparison.
  select auth_user_id, status, approved_player_id, team_id, season,
         signup_name_realm, coalesce(swap_class_spec_id, class_spec_id),
         off_specs, main_swap, swap_from_name_realm, player_note
    into v_owner, v_status, v_approved_player_id, v_team_id, v_row_season,
         v_current_name_realm, v_current_class_spec_id,
         v_old_off_specs, v_old_main_swap, v_old_swap_from_name_realm, v_old_player_note
  from public.season_signups where id = p_signup_id;

  if v_owner is null or v_owner is distinct from v_uid then
    raise exception 'Signup not found';
  end if;
  if v_status = 'rejected' then
    raise exception 'This signup was not approved and can no longer be edited';
  end if;
  if v_status = 'added' then
    if not exists (
      select 1 from public.team_seasons ts
      where ts.team_id = v_team_id and ts.season_code = v_row_season and ts.signups_open
    ) then
      raise exception 'This signup has already been added to the roster and can no longer be edited';
    end if;
  elsif not (v_status = 'pending' or (v_status = 'approved' and v_approved_player_id is null)) then
    raise exception 'This signup can no longer be edited';
  end if;

  -- An 'added' signup's own stored name/class/spec can go stale the moment
  -- an officer edits the linked player directly (rename, class/spec change)
  -- -- the live players row is the real current truth in that case, not
  -- whatever this signup last recorded.
  if v_approved_player_id is not null then
    select name_realm, class_spec_id into v_live_name_realm, v_live_class_spec_id
    from public.players where id = v_approved_player_id;
    if found then
      v_current_name_realm := v_live_name_realm;
      v_current_class_spec_id := v_live_class_spec_id;
    end if;
  end if;

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  v_new_class_spec_id := case when p_main_swap then null else v_class_spec_id end;
  v_new_swap_class_spec_id := case when p_main_swap then v_class_spec_id else null end;
  v_new_swap_from_name_realm := case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end;

  v_no_change :=
    v_current_name_realm is not distinct from p_name_realm
    and v_current_class_spec_id is not distinct from coalesce(v_new_swap_class_spec_id, v_new_class_spec_id)
    and v_old_off_specs is not distinct from nullif(p_off_specs, '')
    and v_old_main_swap is not distinct from p_main_swap
    and v_old_swap_from_name_realm is not distinct from v_new_swap_from_name_realm
    and v_old_player_note is not distinct from nullif(p_player_note, '');

  update public.season_signups s set
    signup_name_realm = p_name_realm,
    class_spec_id = v_new_class_spec_id,
    off_specs = nullif(p_off_specs, ''),
    main_swap = p_main_swap,
    swap_class_spec_id = v_new_swap_class_spec_id,
    swap_from_name_realm = v_new_swap_from_name_realm,
    player_note = nullif(p_player_note, ''),
    status = case when not v_no_change and s.status in ('approved', 'added') then 'pending' else s.status end,
    approved_player_id = case when not v_no_change and s.status = 'added' then null else s.approved_player_id end,
    reviewed_at = case when not v_no_change and s.status in ('approved', 'added') then null else s.reviewed_at end,
    reviewed_by = case when not v_no_change and s.status in ('approved', 'added') then null else s.reviewed_by end,
    signup_officer_note = case when not v_no_change and s.status in ('approved', 'added') then null else s.signup_officer_note end
  where s.id = p_signup_id
    and s.auth_user_id = v_uid
    and (
      s.status = 'pending'
      or (s.status = 'approved' and s.approved_player_id is null)
      or (
        s.status = 'added'
        and exists (
          select 1 from public.team_seasons ts
          where ts.team_id = s.team_id and ts.season_code = s.season and ts.signups_open
        )
      )
    )
  returning s.id into v_updated_id;

  if not found then
    raise exception 'This signup can no longer be edited';
  end if;

  return v_updated_id;
end $$;

-- The view keeps approved rows on the tiers the team has open. Same columns
-- and the same bypass-RLS shape as 20260726104522 left it (#503 makes it a
-- function after this); only the season join moves.
create or replace view public.incoming_roster as
  select s.id as signup_id,
         s.team_id,
         s.signup_name_realm,
         cs.class,
         cs.spec,
         cs.role,
         s.swap_from_name_realm
  from public.season_signups s
  join public.team_seasons ts on ts.team_id = s.team_id and ts.season_code = s.season and ts.signups_open
  left join public.classes_specs cs on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
  where s.status = 'approved' and s.approved_player_id is null;

-- The three keys nothing reads any more.
update public.team_settings
set config = config - 'activeSignupSeason' - 'signupsOpen' - 'wishlistOpen'
where config ?| array['activeSignupSeason', 'signupsOpen', 'wishlistOpen'];
