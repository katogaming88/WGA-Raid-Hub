-- #1871: a character change at season signup keeps the raider's own Trial status.
--
-- A signup's Trial is blank until an officer ticks or unticks it, and both
-- ways of closing signups (promote_season_signups by hand,
-- close_started_season_signups when the season starts) read blank as Trial.
-- So a raider who is not a Trial today and signs up on another character
-- went on next season's roster as a Trial, dropping in loot priority.
--
-- Now blank on a character change takes the Trial status of the character
-- being left (the plan's from_player_id), the way an approved main swap does
-- in review_main_swap_request. New people and first mains, with no character
-- being left, still start as Trial, and an officer's tick or untick still
-- wins. Only that one expression changes in each function.

CREATE OR REPLACE FUNCTION public.promote_season_signups(p_team_id integer, p_season text, p_expected text, p_archive_player_ids integer[] DEFAULT '{}'::integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan jsonb;
  v_step record;
  v_season_name text;
  v_reviewer integer;
  v_player_id integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select display_name into v_season_name from public.seasons where code = p_season;
  if v_season_name is null then
    raise exception '% is not a season this site knows', p_season;
  end if;

  -- 1.
  perform 1 from public.season_signups
   where team_id = p_team_id and season = p_season
   order by id
     for update;

  -- 2.
  perform 1 from public.team_members tm
   where tm.team_id = p_team_id
     and (exists (select 1 from public.players p
                   where p.team_member_id = tm.id and p.archived_at is null)
          or exists (select 1 from public.season_signups s
                       join public.people pe on pe.id = tm.person_id
                      where s.team_id = p_team_id and s.season = p_season
                        and (s.person_id = pe.id or (s.person_id is null and s.auth_user_id = pe.auth_user_id))))
   order by tm.id
     for share;

  -- 3.
  v_plan := public.signup_promotion_plan(p_team_id, p_season);
  if md5(v_plan::text) is distinct from p_expected then
    raise exception 'The signups or the roster changed since the preview was read. Read it again.';
  end if;
  if exists (
    select unnest(coalesce(p_archive_player_ids, '{}'))
    except
    select (e ->> 'player_id')::integer from jsonb_array_elements(v_plan) e where e ->> 'kind' = 'archives'
  ) then
    raise exception 'A character to archive is not one the preview lists. Read it again.';
  end if;

  select id into v_reviewer from public.team_members
   where team_id = p_team_id and person_id = public.my_person_id();

  -- 4.
  for v_step in
    select x.signup_id, x.from_player_id, s.is_trial, s.is_backup_tank, s.is_backup_healer
      from jsonb_to_recordset(v_plan) as x(kind text, signup_id integer, from_player_id integer)
      join public.season_signups s on s.id = x.signup_id
     where x.kind in ('stays', 'swaps', 'first_mains', 'joins')
     order by x.signup_id
  loop
    update public.season_signups
       set status = 'approved', reviewed_at = now(), reviewed_by = v_reviewer
     where id = v_step.signup_id and status = 'pending';
    perform public.add_signup_to_roster(
      v_step.signup_id, coalesce(v_step.is_trial, (select p.is_trial from public.players p where p.id = v_step.from_player_id), true), v_step.from_player_id,
      v_step.is_backup_tank, v_step.is_backup_healer
    );
  end loop;

  -- 5.
  for v_player_id in
    select distinct unnest(coalesce(p_archive_player_ids, '{}')) order by 1
  loop
    perform public.archive_player(v_player_id, 'no_signup', v_season_name);
    perform public.write_audit_log(
      p_team_id, 'Player Removed', 'players', v_player_id, to_jsonb('no_signup: ' || v_season_name)
    );
  end loop;

  -- 6.
  perform public.set_team_season(p_team_id, p_season, false, null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_started_season_signups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_open record;
  v_plan jsonb;
  v_step record;
  v_member record;
  v_player_id integer;
  v_closed integer := 0;
begin
  for v_open in
    select ts.id, ts.team_id, ts.season_code, s.display_name
      from public.team_seasons ts
      join public.seasons s on s.code = ts.season_code
     where ts.signups_open and s.starts_at <= v_today
     order by ts.team_id, ts.season_code
  loop
    -- One team's failure leaves the others to close; it is retried next hour.
    begin
      -- The locks promote_season_signups() takes, in its order (#1467): the
      -- signups, then the memberships, and the team_seasons row last, so a
      -- leader closing by hand at the same moment waits instead of
      -- deadlocking.
      perform 1 from public.season_signups
       where team_id = v_open.team_id and season = v_open.season_code
       order by id
         for update;

      perform 1 from public.team_members tm
       where tm.team_id = v_open.team_id
         and (exists (select 1 from public.players p
                       where p.team_member_id = tm.id and p.archived_at is null)
              or exists (select 1 from public.season_signups s
                           join public.people pe on pe.id = tm.person_id
                          where s.team_id = v_open.team_id and s.season = v_open.season_code
                            and (s.person_id = pe.id or (s.person_id is null and s.auth_user_id = pe.auth_user_id))))
       order by tm.id
         for share;

      -- Signups closed by hand while this waited: nothing left to do.
      perform 1 from public.team_seasons where id = v_open.id and signups_open for update;
      if not found then
        continue;
      end if;

      v_plan := public.signup_promotion_plan(v_open.team_id, v_open.season_code);

      for v_step in
        select x.signup_id, x.from_player_id, x.from_name_realm,
               s.is_trial, s.is_backup_tank, s.is_backup_healer, s.person_id, s.auth_user_id,
               concat_ws(' ', cs.class, cs.spec, cs.role) as spec_label
          from jsonb_to_recordset(v_plan) as x(kind text, signup_id integer, from_player_id integer, from_name_realm text)
          join public.season_signups s on s.id = x.signup_id
          left join public.classes_specs cs on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
         where x.kind in ('stays', 'swaps', 'first_mains', 'joins')
         order by x.signup_id
      loop
        -- An archived signer comes back as a raider, as restore_team_member()
        -- does for an officer's add (#1402), before add_signup_to_roster(),
        -- which would otherwise ask an officer to.
        select tm.id, tm.role into v_member
          from public.team_members tm
          join public.people pe on pe.id = tm.person_id
         where tm.team_id = v_open.team_id
           and tm.archived_at is not null
           and (pe.id = v_step.person_id or (v_step.person_id is null and pe.auth_user_id = v_step.auth_user_id))
           for update of tm;
        if found then
          update public.team_members set archived_at = null, role = 'raider' where id = v_member.id;
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'team_member_restored', 'team_member', v_member.id,
                  jsonb_build_object('role', 'raider', 'archived_role', v_member.role));
        end if;

        update public.season_signups
           set status = 'approved', reviewed_at = now(), reviewed_by = null
         where id = v_step.signup_id and status = 'pending';
        v_player_id := public.add_signup_to_roster(
          v_step.signup_id, coalesce(v_step.is_trial, (select p.is_trial from public.players p where p.id = v_step.from_player_id), true), v_step.from_player_id,
          v_step.is_backup_tank, v_step.is_backup_healer
        );

        -- The rows add_signup_to_roster() writes for a signed-in officer.
        insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
        values (v_open.team_id, null, true, 'Player Added', 'players', v_player_id,
                to_jsonb(concat_ws(', ',
                  coalesce(nullif(v_step.spec_label, ''), 'Unknown spec'),
                  'from signup',
                  case when v_step.from_name_realm is not null then 'main swap from ' || v_step.from_name_realm end,
                  case when v_member.id is not null then 'membership restored' end)));
        if v_step.from_name_realm is not null then
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'Main Swap: Old Character Removed', 'players', v_step.from_player_id,
                  (select to_jsonb('Replaced by ' || signup_name_realm) from public.season_signups where id = v_step.signup_id));
        end if;
      end loop;

      -- Every character the plan lists, as archive_player() archives one:
      -- the membership held before the character (#1432).
      for v_step in
        select (e ->> 'player_id')::integer as player_id
          from jsonb_array_elements(v_plan) e
         where e ->> 'kind' = 'archives'
         order by 1
      loop
        perform public.hold_team_member((select team_member_id from public.players where id = v_step.player_id));
        update public.players set archived_at = now()
         where id = v_step.player_id and archived_at is null;
        if found then
          insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
          values (v_step.player_id, v_open.team_id, 'no_signup', v_open.display_name)
          on conflict (player_id) do update
             set archived_reason = excluded.archived_reason,
                 archived_reason_detail = excluded.archived_reason_detail;
          insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
          values (v_open.team_id, null, true, 'Player Removed', 'players', v_step.player_id,
                  to_jsonb('no_signup: ' || v_open.display_name));
        end if;
      end loop;

      update public.team_seasons set signups_open = false, updated_at = now() where id = v_open.id;
      insert into public.audit_log (team_id, actor_id, automatic, action, target_type, target_id, detail)
      values (v_open.team_id, null, true, 'Signups Closed', 'team_seasons', v_open.id::integer,
              jsonb_build_object('season', v_open.season_code));

      v_closed := v_closed + 1;
    exception when others then
      raise warning 'Closing % signups for team % failed: %', v_open.season_code, v_open.team_id, sqlerrm;
    end;
  end loop;
  return v_closed;
end;
$function$;
