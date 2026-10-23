-- #1342 part 1: the Projected Roster for every signup, and closing signups no
-- earlier than two weeks before the season starts (#648).
--
-- In the new app a signup goes straight onto the Projected Roster with no
-- approval step (Kat, 2026-10-23), so it stays 'pending' until signups close.
-- incoming_roster, the public read the Projected Roster tab uses, listed only
-- 'approved' signups, so it would never show one. It now lists pending ones
-- too, with the status, so the current site's public roster keeps reading
-- only approved ones until cutover (js/common.js filters on it).

create or replace view public.incoming_roster as
 SELECT s.id AS signup_id,
    s.team_id,
    s.signup_name_realm,
    cs.class,
    cs.spec,
    cs.role,
    s.swap_from_name_realm,
    s.status
   FROM season_signups s
     JOIN team_seasons ts ON ts.team_id = s.team_id AND ts.season_code = s.season
     LEFT JOIN classes_specs cs ON cs.id = COALESCE(s.swap_class_spec_id, s.class_spec_id)
  WHERE s.status = ANY (ARRAY['pending'::text, 'approved'::text]) AND s.approved_player_id IS NULL;

grant select on public.incoming_roster to anon, authenticated;

-- Closing signups (#1467) is refused until 14 days before the season starts
-- (#648, Kat 2026-10-23). The team leader can close any time from then on;
-- signups close by themselves when the season starts (filed separately).
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
  v_starts_at date;
  v_reviewer integer;
  v_player_id integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select display_name, starts_at into v_season_name, v_starts_at from public.seasons where code = p_season;
  if v_season_name is null then
    raise exception '% is not a season this site knows', p_season;
  end if;

  -- Not until two weeks before the season starts (#648), so a pick made
  -- months early is not locked in while raiders still change their minds.
  if (now() at time zone 'America/New_York')::date < v_starts_at - 14 then
    raise exception 'Signups for % can be closed from % (14 days before it starts).', v_season_name, v_starts_at - 14;
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
      v_step.signup_id, coalesce(v_step.is_trial, true), v_step.from_player_id,
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
