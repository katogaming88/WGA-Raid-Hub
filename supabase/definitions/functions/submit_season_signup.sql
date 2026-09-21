-- Function public.submit_season_signup: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.submit_season_signup(p_team_id integer, p_name_realm text, p_class text, p_spec text, p_off_specs text DEFAULT ''::text, p_main_swap boolean DEFAULT false, p_player_note text DEFAULT NULL::text, p_swap_from_name_realm text DEFAULT NULL::text, p_season text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
