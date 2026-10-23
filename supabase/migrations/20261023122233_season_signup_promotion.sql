-- #1467 (part of #1342): closing signups puts the declared mains on the
-- roster and takes the raiders who did not sign up off it, in one step.
--
-- Like a club's renewal day: renewals come in while the window is open, and
-- on the closing date the register is rewritten in one go. Members who
-- renewed carry on, anyone who changed character moves across, and members
-- who did not renew are marked lapsed. The officer reads the whole list first
-- (preview_signup_promotion()) and unticks anyone who stays; the promotion
-- (promote_season_signups()) then does exactly what was read, or refuses.
--
-- Only roster characters are archived, never the membership: a raider who did
-- not sign up stays on the team, and asking for a first main (#1463) brings
-- them back with an officer's approval.

-- The seventh reason a character or membership leaves: "Did not sign up".
alter table public.player_officer_notes
  drop constraint player_officer_notes_archived_reason_check,
  add constraint player_officer_notes_archived_reason_check check (
    archived_reason is null or archived_reason in (
      'schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup'
    )
  );

alter table public.removal_reasons
  drop constraint removal_reasons_reason_check,
  add constraint removal_reasons_reason_check check (
    reason in ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup')
  );

CREATE OR REPLACE FUNCTION public.archive_team_member(p_team_id integer, p_team_member_id integer, p_reason text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_role text;
  v_archived_at timestamptz;
  v_player_ids integer[];
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- The same seven player_officer_notes.archived_reason accepts.
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup') then
    raise exception 'That is not one of the reasons a membership can be archived for';
  end if;

  -- Locked, so two archives of the same person cannot both pass the
  -- already-archived check below.
  select team_id, role, archived_at into v_team_id, v_role, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  -- Ending an officer's membership is a role change, which belongs to the team
  -- leader or a site admin, as in admin_revoke_team_role(). The leader's own is
  -- a site admin's alone: a team left with no active leader can only be given
  -- one by a site admin.
  if v_role = 'team_leader' and not public.is_site_admin() then
    raise exception 'Only a site admin can archive the team leader';
  end if;
  if v_role = 'officer'
     and not (coalesce(public.my_team_role(p_team_id) = 'team_leader', false) or public.is_site_admin()) then
    raise exception 'Only the team leader or a site admin can archive an officer';
  end if;

  if v_archived_at is not null then
    return;
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}') into v_player_ids
    from public.players p
   where p.team_member_id = p_team_member_id and p.archived_at is null;

  -- Logged before the archive: write_audit_log() re-checks the caller's own
  -- officer status live, so it has to run while the caller's rows read as
  -- they did when the call started.
  perform public.write_audit_log(
    p_team_id, 'team_member_archived', 'team_member', p_team_member_id,
    jsonb_build_object('reason', p_reason, 'detail', p_detail, 'player_ids', to_jsonb(v_player_ids))
  );

  -- The membership's own reason (#1427). Its characters' rows come from the
  -- notes write below, through record_removal_reason().
  insert into public.removal_reasons (team_id, team_member_id, reason, detail, removed_by)
  values (p_team_id, p_team_member_id, p_reason, p_detail, public.my_person_id());

  update public.team_members set archived_at = now() where id = p_team_member_id;
  update public.players set archived_at = now() where id = any (v_player_ids);

  -- Only the two archive columns are written on conflict, as in
  -- archive_player(): an officer note already on the character stays.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  select player_id, p_team_id, p_reason, p_detail from unnest(v_player_ids) as player_id
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;
end;
$function$;

comment on function public.archive_team_member(integer, integer, text, text) is
  'Officer-only: archives a team_members row for someone who left (#1355), and their active characters with it, rather than deleting either -- players.team_member_id is ON DELETE SET NULL, so a delete would sever an archived character''s history and free it for the next Battle.net import to claim as theirs (Rex''s review, 2026-09-28). Records the reason (one of the seven archive_player() takes) and the detail on each character it archives, in the audit entry with the archived character ids, and in removal_reasons, one row for the membership and one per character (#1427). An officer''s membership is archived only by the team leader or a site admin, the team leader''s only by a site admin. A second archive does nothing. team_invite_link_join() clears archived_at if they come back.';

-- What closing a season's signups would do on a team, as a jsonb array, one
-- object per signup still to put on the roster and per character nobody
-- signed up for, sorted so the same state always reads the same:
--
--   stays        the signup names a character already on the roster
--   skipped      the officer's call (reason): the signer has more than one
--                character on the roster and names another
--                (several_characters), or the character it would swap from
--                is another signup's too (character_taken)
--   swaps        the signer's one character on the roster is replaced
--                (from_player_id); a current-site signup whose signer has
--                none linked swaps from the character it named, if nobody
--                else holds that character
--   first_mains  the signer is or was on the team (an archived membership
--                comes back) with no character on the roster
--   joins        the signer is not on the team
--   archives     a character on the roster that no signup names, by name or
--                as the one it swaps from, and whose person sent none
--
-- The signer is the signup's person, or for a current-site signup the
-- account that sent it. Added signups are already on the roster and only
-- count as signed up; rejected ones do not count.
create function public.signup_promotion_plan(p_team_id integer, p_season text)
returns jsonb
language sql
stable
set search_path = public
as $$
  with sig as (
    select s.id, s.status, s.signup_name_realm,
           lower(replace(s.signup_name_realm, ' ', '')) as name_key,
           lower(replace(s.swap_from_name_realm, ' ', '')) as from_key,
           (select tm.id
              from team_members tm
              join people pe on pe.id = tm.person_id
             where tm.team_id = s.team_id
               and (pe.id = s.person_id or (s.person_id is null and pe.auth_user_id = s.auth_user_id))
             order by tm.id
             limit 1) as member_id
      from season_signups s
     where s.team_id = p_team_id and s.season = p_season and s.status <> 'rejected'
  ),
  active as (
    select p.id, p.name_realm, p.name_realm_key, p.team_member_id
      from players p
     where p.team_id = p_team_id and p.archived_at is null
  ),
  todo as (
    select sig.*,
           (select a.id from active a where a.name_realm_key = sig.name_key) as same_id,
           (select count(*) from active a where a.team_member_id = sig.member_id) as held,
           coalesce(
             (select min(a.id) from active a where a.team_member_id = sig.member_id having count(*) = 1),
             (select a.id from active a
               where a.name_realm_key = sig.from_key
                 and (a.team_member_id is null or a.team_member_id = sig.member_id))
           ) as from_id
      from sig
     where sig.status in ('pending', 'approved')
  ),
  plan as (
    select case when t.same_id is not null then 'stays'
                when t.held > 1 or taken then 'skipped'
                when t.from_id is not null then 'swaps'
                when t.member_id is not null then 'first_mains'
                else 'joins' end as kind,
           case when t.same_id is not null then null
                when t.held > 1 then 'several_characters'
                when taken then 'character_taken' end as reason,
           t.id, t.signup_name_realm, t.same_id, t.from_id
      from todo t
     cross join lateral (
       select t.from_id is not null and exists (
                select 1 from todo o
                 where o.id <> t.id and (o.from_id = t.from_id or o.same_id = t.from_id)
              ) as taken
     ) x
  )
  select coalesce(jsonb_agg(r order by r.kind, r.name_realm, r.signup_id, r.player_id), '[]'::jsonb)
    from (
      select pl.kind,
             pl.id as signup_id,
             pl.same_id as player_id,
             pl.signup_name_realm as name_realm,
             case when pl.kind = 'swaps' then pl.from_id end as from_player_id,
             case when pl.kind = 'swaps' then (select a.name_realm from active a where a.id = pl.from_id) end as from_name_realm,
             pl.reason
        from plan pl
      union all
      select 'archives', null, a.id, a.name_realm, null, null, null
        from active a
       where not exists (
               select 1 from sig
                where sig.name_key = a.name_realm_key
                   or sig.from_key = a.name_realm_key
                   or sig.member_id = a.team_member_id
             )
         and not exists (select 1 from plan where plan.kind = 'swaps' and plan.from_id = a.id)
    ) r;
$$;

alter function public.signup_promotion_plan(integer, text) owner to postgres;
revoke all on function public.signup_promotion_plan(integer, text) from public, anon, authenticated;

-- The officer's preview: the plan grouped by what happens to each name, and
-- `expected`, which promote_season_signups() takes back to prove nothing
-- changed in between. Team leader and site admins only, as for opening
-- signups (set_team_season()).
create function public.preview_signup_promotion(p_team_id integer, p_season text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  v_plan := public.signup_promotion_plan(p_team_id, p_season);

  return jsonb_build_object('expected', md5(v_plan::text))
      || (select jsonb_object_agg(k, coalesce(
                   (select jsonb_agg(jsonb_strip_nulls(e - 'kind'))
                      from jsonb_array_elements(v_plan) e
                     where e ->> 'kind' = k),
                   '[]'::jsonb))
            from unnest(array['stays', 'joins', 'swaps', 'first_mains', 'archives', 'skipped']) k);
end;
$$;

alter function public.preview_signup_promotion(integer, text) owner to postgres;
revoke all on function public.preview_signup_promotion(integer, text) from public, anon;
grant execute on function public.preview_signup_promotion(integer, text) to authenticated;

-- Closing signups, in one transaction: every signup in the plan but the
-- skipped goes onto the roster through add_signup_to_roster(), with its Trial
-- (a trial when unset) and backup flags and the character it swaps from; the
-- characters in p_archive_player_ids are archived as "Did not sign up", with
-- the season's name as the detail; and the season's signups close. Skipped
-- signups stay pending for the officer to settle by hand.
--
-- It refuses, changing nothing, when the plan no longer reads as p_expected
-- (a signup arrived, or someone left the roster, after the preview was read)
-- or when a character to archive is not one the plan lists.
--
-- Lock order, statement by statement. Every path that takes a character off
-- the roster takes its membership first (#1432); this takes all of them
-- before any character.
--   1. The season's signups on the team, FOR UPDATE, lowest id first: the
--      lock add_signup_to_roster() and declare_season_signup() take first.
--      A signup the officer or the signer edits now waits, then reads the
--      result.
--   2. Every membership on the team with an active character or a signup for
--      the season, FOR SHARE, lowest id first. Archive Member (FOR UPDATE,
--      then the characters) waits behind this, or this behind it; a Remove's
--      own share hold does not conflict.
--   3. The plan is read under those locks and checked against p_expected.
--   4. Per signup, lowest id first: the signup row (status; held in 1), then
--      add_signup_to_roster(): its own holds on the memberships (held in 2),
--      a restore of an archived signer (FOR UPDATE on a membership held
--      FOR SHARE in 2), the character (insert or update; its foreign key
--      to the membership a KEY SHARE, covered by 2), the old character on a
--      swap, its attendance, the audit rows.
--   5. Per ticked character, lowest id first: archive_player(): the
--      membership (held in 2), the character, its player_officer_notes row,
--      whose trigger writes removal_reasons with KEY SHAREs on the character
--      and the membership; then the audit row.
--   6. The team_seasons row, through set_team_season(), which closes signups.
--
-- ponytail: a signup committed in the same instant as the promotion, by a
-- caller that read signups as open, stays pending after they close and shows
-- on the Projected Roster for the officer. Locking the team_seasons row in
-- every signup function would close that gap.
create function public.promote_season_signups(
  p_team_id integer,
  p_season text,
  p_expected text,
  p_archive_player_ids integer[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

alter function public.promote_season_signups(integer, text, text, integer[]) owner to postgres;
revoke all on function public.promote_season_signups(integer, text, text, integer[]) from public, anon;
grant execute on function public.promote_season_signups(integer, text, text, integer[]) to authenticated;
