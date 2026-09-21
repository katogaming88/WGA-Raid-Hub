-- Function public.update_own_signup: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.update_own_signup(p_signup_id integer, p_name_realm text, p_class text, p_spec text, p_off_specs text DEFAULT ''::text, p_main_swap boolean DEFAULT false, p_player_note text DEFAULT NULL::text, p_swap_from_name_realm text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
