-- #1646, part 1 of 2: the roster, schedule, RSVP, attendance, signup and
-- report checks ask the team grid's permission (#1645) instead of "officer
-- or team leader". Loot, priority, settings and the team-leader-only checks
-- are part 2.
--
-- With the default grid, Officers and Team Owners pass every check they
-- passed as officers and team leaders, and an Assistant now passes these
-- too. The current site is unaffected: an Assistant is a raider there.
--
--   edit_roster     players, names, officer notes, memberships, people and
--                   characters on the team, main swaps, removal reasons,
--                   invite links, Battle.net and unnamed-member lookups
--   edit_schedule   schedule, exceptions, schedule settings, lineups,
--                   boss picks and boss groups
--   see_rsvps       everyone's RSVPs and notes
--   attendance      attendance, raid night participation, the rotator week
--                   and setting an RSVP for someone (bench)
--   manage_signups  season signups; adding one to the roster asks edit_roster too
--   view_reports    raid reports and kills
--
-- The guild officer and site admin arms are unchanged: guild-level checks
-- are the next issue.

-- The teams where the caller's rank has this permission, for the table
-- rules: one call per query, as my_officer_team_ids() was. Executable by
-- anon because the rules are evaluated for signed-out reads too; empty
-- there. has_team_permission() now asks it, so the two never disagree.
create function public.my_permission_team_ids(p_permission text)
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  with ranks as (
    select m.team_id, m.rank
      from team_members m
     where m.person_id = my_person_id() and m.archived_at is null
    union all
    select t.id, 'officer'
      from guild_ranks g
      join teams t on t.guild_id = g.guild_id
     where g.person_id = my_person_id() and g.officer_on_every_team
  )
  select coalesce(array_agg(distinct r.team_id), '{}')
    from ranks r
   where exists (select 1 from rank_permissions k where k.permission = p_permission and k.scope = 'team')
     and (r.rank = 'owner'
          or exists (select 1 from team_rank_permissions p
                      where p.team_id = r.team_id and p.rank = r.rank
                        and p.permission = p_permission));
$$;

comment on function public.my_permission_team_ids(text) is
  'The teams where the caller''s rank has this permission on the team''s grid (#1646): every team they own, any other where their rank''s row is there, and with "Officer on every team" every team in that guild as an officer. Empty, never null.';

revoke all on function public.my_permission_team_ids(text) from public;
grant execute on function public.my_permission_team_ids(text) to anon, authenticated;

create or replace function public.has_team_permission(p_team_id integer, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_team_id = any (my_permission_team_ids(p_permission)), false);
$$;

-- The table rules. Each keeps its name and its other arms.

-- Roster
alter policy "Officers write players" on public.players
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write names" on public.names
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write player_officer_notes" on public.player_officer_notes
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read own team_members" on public.team_members
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read people on their teams" on public.people
  using (id in (select tm.person_id from team_members tm
                 where tm.team_id = any ((select my_permission_team_ids('edit_roster'))::integer[]))
         or id in (select tm.person_id from team_members tm
                    where tm.team_id = any ((select my_guild_officer_team_ids())::integer[]))
         or (select is_site_admin()));

alter policy "Officers read characters on their teams" on public.characters
  using (person_id in (select tm.person_id from team_members tm
                 where tm.team_id = any ((select my_permission_team_ids('edit_roster'))::integer[]))
         or person_id in (select tm.person_id from team_members tm
                    where tm.team_id = any ((select my_guild_officer_team_ids())::integer[]))
         or (select is_site_admin()));

alter policy "Officers read main swap requests on their teams" on public.main_swap_requests
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read removal_reasons" on public.removal_reasons
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read team_invite_links" on public.team_invite_links
  using (team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

-- Schedule and boss lineups
alter policy "Officers write raid_schedule" on public.raid_schedule
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write raid_schedule_exceptions" on public.raid_schedule_exceptions
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write team_schedule_settings" on public.team_schedule_settings
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read raid_night_lineups" on public.raid_night_lineups
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read raid_night_bosses" on public.raid_night_bosses
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read boss_groups" on public.boss_groups
  using (team_id = any ((select my_permission_team_ids('edit_schedule'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

-- RSVPs, attendance and bench
alter policy "Officers read raid_rsvps" on public.raid_rsvps
  using (team_id = any ((select my_permission_team_ids('see_rsvps'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers write attendance" on public.attendance
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read raid_night_participation" on public.raid_night_participation
  using (team_id = any ((select my_permission_team_ids('attendance'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

-- Season signups
alter policy "Officers read signups" on public.season_signups
  using (team_id = any ((select my_permission_team_ids('manage_signups'))::integer[])
         or (select is_site_admin()));

alter policy "Officers update signups" on public.season_signups
  using (team_id = any ((select my_permission_team_ids('manage_signups'))::integer[])
         or (select is_site_admin()))
  with check (team_id = any ((select my_permission_team_ids('manage_signups'))::integer[])
         or (select is_site_admin()));

-- Reports
alter policy "Officers read team_raid_reports" on public.team_raid_reports
  using (team_id = any ((select my_permission_team_ids('view_reports'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

alter policy "Officers read team_raid_kills" on public.team_raid_kills
  using (team_id = any ((select my_permission_team_ids('view_reports'))::integer[])
         or team_id = any ((select my_guild_officer_team_ids())::integer[])
         or (select is_site_admin()));

-- The functions. Each body is as it was except its check. write_audit_log()
-- lets in anyone holding a team permission that changes something, since
-- every officer-side action logs through it; the read-only ones (RSVPs,
-- reports, loot, the audit log) and a raider's own two do not.
-- add_signup_to_roster() asks manage_signups and edit_roster both, and
-- archive_team_member() asks promote_assistants as well to archive an
-- Assistant.

create or replace function public.add_signup_to_roster(p_signup_id integer, p_is_trial boolean default true, p_archive_player_id integer default NULL::integer, p_is_backup_tank boolean default false, p_is_backup_healer boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
  v_archived_team_member_id integer;
  v_archived_join_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_prior_archived_at timestamptz;
  v_prior_team_member_id integer;
  v_signer_member_id integer;
  v_signer_archived boolean;
  v_restored boolean := false;
  v_spec_label text;
  v_archived_name_realm text;
  v_old_member_id integer;
  v_hold integer;
  v_team_id integer;
begin
  -- Its own check now that it runs as its owner (#1434), before anything is
  -- locked or reported: who the season_signups read and write rules let
  -- through before, the team's officers and team leader or a site admin. Not a
  -- guild officer, whom those rules never let in (fresh-agent review). Nobody
  -- signed in is the season-start job (close_started_season_signups()) or a
  -- script; anon cannot call it. An unknown signup has no team, so it is
  -- refused here too, except to a site admin, who is told below.
  select team_id into v_team_id from public.season_signups where id = p_signup_id;
  -- Adding a signup is a roster edit too, and restore_team_member() and
  -- hold_team_member() below ask edit_roster, so this asks both (#1646).
  if auth.uid() is not null and not (
    (public.has_team_permission(v_team_id, 'manage_signups')
     and public.has_team_permission(v_team_id, 'edit_roster'))
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
  end if;
  -- The check above was for the team read before the lock; a signup moved to
  -- another team in between is refused rather than added to a team the caller
  -- was never checked for (CodeRabbit).
  if auth.uid() is not null and v_signup.team_id is distinct from v_team_id then
    raise exception 'Not authorized';
  end if;

  if v_signup.status is distinct from 'approved' then
    raise exception 'signup % is not in approved status (is %)',
      p_signup_id, v_signup.status;
  end if;

  select p.archived_at, p.team_member_id
    into v_prior_archived_at, v_prior_team_member_id
    from public.players p
   where p.team_id = v_signup.team_id
     and p.name_realm_key = lower(replace(v_signup.signup_name_realm, ' ', ''));

  if v_signup.person_id is not null or v_signup.auth_user_id is not null then
    select tm.id, tm.archived_at is not null into v_signer_member_id, v_signer_archived
      from public.team_members tm
      join public.people pe on pe.id = tm.person_id
     where tm.team_id = v_signup.team_id
       and (pe.id = v_signup.person_id
            or (v_signup.person_id is null and pe.auth_user_id = v_signup.auth_user_id));
  end if;

  if p_archive_player_id is not null then
    select team_member_id into v_old_member_id
      from public.players
     where id = p_archive_player_id and team_id = v_signup.team_id;
  end if;

  -- An officer adding the signup brings an archived signer back (#1402).
  -- The read above takes no lock, so the restore's own answer, read under
  -- its lock, says whether this add is the one that brought them back. It
  -- runs before the character is written, so a restore locks the membership
  -- before the character, the order archive_team_member() and the invite
  -- link take.
  if v_signer_archived then
    v_restored := public.restore_team_member(v_signup.team_id, v_signer_member_id);
  end if;

  -- The signer's membership and the old character's before any character
  -- (#1432), lowest id first, so the add waits behind Archive Member instead
  -- of deadlocking with it. As in archive_player(), a claim linking the old
  -- character after the read above is not covered.
  for v_hold in
    select distinct m from unnest(array[v_signer_member_id, v_old_member_id]) as m
     where m is not null
     order by m
  loop
    perform public.hold_team_member(v_hold);
  end loop;

  -- An archive that landed while the add waited: the signer comes back, as if
  -- it had landed before the add. Two adds for one signer meeting an archive
  -- in the same instant can deadlock here, and one is retried.
  if v_signer_member_id is not null and not v_restored then
    select archived_at is not null into v_signer_archived
      from public.team_members where id = v_signer_member_id;
    if v_signer_archived then
      v_restored := public.restore_team_member(v_signup.team_id, v_signer_member_id);
    end if;
  end if;

  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date,
    is_backup_tank, is_backup_healer
  )
  values (v_signup.team_id, v_signup.signup_name_realm,
          coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id),
          p_is_trial, v_today,
          p_is_backup_tank, p_is_backup_healer)
  on conflict (team_id, name_realm_key) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial  = case when players.archived_at is not null
                         then excluded.is_trial else players.is_trial end,
        join_date = case when players.archived_at is not null
                         then excluded.join_date else players.join_date end,
        is_backup_tank = case when players.archived_at is not null
                         then excluded.is_backup_tank else players.is_backup_tank end,
        is_backup_healer = case when players.archived_at is not null
                         then excluded.is_backup_healer else players.is_backup_healer end,
        -- The officer's wishlist and BiS exceptions were for the last stint
        -- (#1616), as the invite link resets them.
        wishlist_allowed = case when players.archived_at is not null
                         then false else players.wishlist_allowed end,
        bis_allowed = case when players.archived_at is not null
                         then false else players.bis_allowed end,
        archived_at = null
  returning id into v_player_id;

  -- A revived row still linked to a different person moves to the signer.
  if v_prior_archived_at is not null
     and v_prior_team_member_id is not null
     and v_signer_member_id is not null
     and v_prior_team_member_id <> v_signer_member_id then
    update public.players set team_member_id = v_signer_member_id
     where id = v_player_id;
  end if;

  -- A declared signup's character is one Battle.net confirmed is the
  -- signer's (#1465), so a row nobody holds becomes theirs now rather than
  -- waiting for a claim. A row someone else holds is left alone. The
  -- character is checked again here, not taken from the signup: the signer
  -- can still retype signup_name_realm through update_own_signup(), and the
  -- character can move to another person while the signup waits. Only a
  -- character still theirs, by the roster row's own name, is linked.
  if v_signup.character_id is not null and v_signer_member_id is not null then
    update public.players p set team_member_id = v_signer_member_id
     where p.id = v_player_id
       and p.team_member_id is null
       and exists (
         select 1 from public.characters c
          where c.id = v_signup.character_id
            and c.person_id = v_signup.person_id
            and c.name_realm_key = p.name_realm_key
       );
  end if;

  if p_archive_player_id is not null then
    select team_member_id, join_date, name_realm
      into v_archived_team_member_id, v_archived_join_date, v_archived_name_realm
      from public.players
     where id = p_archive_player_id and team_id = v_signup.team_id;

    -- The link stays on the archived character (#941): its attendance, loot
    -- and BoE finds still belong to this person.
    -- A character already off the roster keeps when it left, which its
    -- removal reason is keyed on.
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id and archived_at is null;

    if v_archived_team_member_id is not null then
      update public.players set team_member_id = v_archived_team_member_id
       where id = v_player_id and team_member_id is null;
    end if;

    -- Only overwrite when the new row is still on today's (local) date. That
    -- covers both the plain-insert path above AND a reactivated same-name-
    -- realm alt: the on-conflict branch already refreshes a reactivated
    -- archived character's join_date to today too (same as it refreshes
    -- is_trial), so there's no "alt's own original date" being protected
    -- here either way -- landing the swapped-from date on top of that
    -- today's-date keeps "main swap = continuation of tenure" true even
    -- when the destination is a known alt, not just a brand-new character.
    if v_archived_join_date is not null then
      update public.players set join_date = v_archived_join_date
       where id = v_player_id and join_date = v_today;
    end if;

    -- Carry attendance history to the new character. Skip any raid_date
    -- the new (destination) player already has its own row for -- that
    -- only happens on a reactivated-alt swap where the alt has independent
    -- attendance, and the unique (team_id, player_id, raid_date)
    -- constraint would otherwise abort the whole swap.
    update public.attendance a set player_id = v_player_id
     where a.player_id = p_archive_player_id
       and a.team_id = v_signup.team_id
       and not exists (
         select 1 from public.attendance b
          where b.team_id = v_signup.team_id
            and b.player_id = v_player_id
            and b.raid_date = a.raid_date
       );

  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  -- Audit (#1136). Same action names and detail shape the Roster tab's own
  -- add and remove write, so both paths read alike in the Audit Log. Skipped
  -- only when nobody is signed in (a service-role or test call), because
  -- write_audit_log() needs an actor and would otherwise abort the add. Such
  -- a call stops earlier for an archived signer: restore_team_member() is an
  -- officer's, and refuses it.
  if auth.uid() is not null then
    select concat_ws(' ', cs.class, cs.spec, cs.role)
      into v_spec_label
      from public.classes_specs cs
     where cs.id = coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id);

    perform public.write_audit_log(
      v_signup.team_id, 'Player Added', 'players', v_player_id,
      to_jsonb(concat_ws(', ',
        coalesce(v_spec_label, 'Unknown spec'),
        'from signup',
        case when v_archived_name_realm is not null then 'main swap from ' || v_archived_name_realm end,
        case when v_restored then 'membership restored' end))
    );

    if v_archived_name_realm is not null then
      perform public.write_audit_log(
        v_signup.team_id, 'Main Swap: Old Character Removed', 'players', p_archive_player_id,
        to_jsonb('Replaced by ' || v_signup.signup_name_realm)
      );
    end if;
  end if;

  return v_player_id;
end $function$;

create or replace function public.also_on_teams(p_team_id integer)
returns TABLE(player_id integer, team_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, t.name
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id and tq.team_id <> p.team_id
    join players q on q.team_member_id = tq.id and q.archived_at is null
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and t.archived_at is null
     and not t.unlisted
     and (
       p_team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
       or (select is_site_admin())
       or (select is_guild_officer_of_team(p_team_id))
     )
   group by p.id, t.name;
$function$;

create or replace function public.archive_player(p_player_id integer, p_reason text, p_detail text)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_archived_at timestamptz;
begin
  select team_id, team_member_id into v_team_id, v_team_member_id from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (public.has_team_permission(v_team_id, 'edit_roster')
          or public.is_guild_officer_of_team(v_team_id)
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- The membership before the character, the order Archive Member takes
  -- (#1432). A claim moving the character to another membership after the
  -- read above is not covered: it would also need that membership archived
  -- in the same instant.
  perform public.hold_team_member(v_team_member_id);

  -- archived_at is null guards a double archive: a second call would
  -- otherwise silently rewrite the first reason with the second one.
  update public.players
     set archived_at = now()
   where id = p_player_id
     and archived_at is null
  returning archived_at into v_archived_at;

  if v_archived_at is null then
    raise exception 'Player % is already archived', p_player_id;
  end if;

  -- Only the two archive columns are written on conflict. A player being
  -- removed may already carry an officer note, and blanking it here would
  -- destroy the note at exactly the moment it is most worth keeping.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  values (p_player_id, v_team_id, p_reason, p_detail)
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;

  return v_archived_at;
end;
$function$;

create or replace function public.archive_team_member(p_team_id integer, p_team_member_id integer, p_reason text, p_detail text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_role text;
  v_rank text;
  v_archived_at timestamptz;
  v_player_ids integer[];
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_guild_officer_of_team(p_team_id)
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
  select team_id, role, rank, archived_at into v_team_id, v_role, v_rank, v_archived_at
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
  -- An Assistant comes back a Raider, so archiving one takes the rank away,
  -- which is the grid's "Promote raiders to Assistant and back" (#1646).
  if v_rank = 'assistant'
     and not (public.has_team_permission(p_team_id, 'promote_assistants')
              or public.is_guild_officer_of_team(p_team_id) or public.is_site_admin()) then
    raise exception 'Only someone who can promote Assistants can archive one';
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

create or replace function public.earlier_characters(p_team_id integer)
returns TABLE(player_id integer, earlier_player_id integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, q.id
    from players p
    join team_members tm on tm.id = p.team_member_id
    join team_members tq on tq.person_id = tm.person_id
    join players q on q.team_member_id = tq.id
    join teams t on t.id = q.team_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and q.id <> p.id
     -- An earlier character is one no longer on its roster: an old main on
     -- this team, or a character on a team the person has left (no active
     -- character there any more). A team they are still on keeps its own total.
     and q.archived_at is not null
     and (
       q.team_id = p.team_id
       or not exists (
         select 1 from players r where r.team_member_id = tq.id and r.archived_at is null
       )
     )
     and (q.team_id = p.team_id or not t.unlisted)
     and (
       p_team_id = any ((select my_permission_team_ids('edit_roster'))::integer[])
       or (select is_site_admin())
       or (select is_guild_officer_of_team(p_team_id))
       or tm.person_id = (select my_person_id())
     );
$function$;

create or replace function public.hold_team_member(p_team_member_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
begin
  if p_team_member_id is null then
    return;
  end if;

  select team_id into v_team_id from public.team_members where id = p_team_member_id;
  if v_team_id is null
     or not (auth.uid() is null
             or public.has_team_permission(v_team_id, 'edit_roster')
             or public.is_guild_officer_of_team(v_team_id)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  perform 1 from public.team_members where id = p_team_member_id for share;
end;
$function$;

create or replace function public.officer_set_rotator_week(p_team_id integer, p_player_id integer, p_week_start date, p_in boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_rotator boolean;
  v_date date;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  select is_rotator into v_is_rotator
  from players
  where id = p_player_id and team_id = p_team_id and archived_at is null;

  if v_is_rotator is null then
    raise exception 'Player not found on this team.';
  end if;
  if not v_is_rotator then
    raise exception 'Player is not a rotator.';
  end if;

  for v_date in
    select gs::date
    from generate_series(p_week_start, p_week_start + 6, interval '1 day') gs
    where (
      exists (
        select 1 from raid_schedule rs
        where rs.team_id = p_team_id
          and rs.active
          and rs.weekday = extract(dow from gs)::int
      )
      or exists (
        select 1 from raid_schedule_exceptions rse
        where rse.team_id = p_team_id
          and rse.raid_date = gs::date
          and rse.exception_type = 'added'
      )
    )
    and not exists (
      select 1 from raid_schedule_exceptions rse2
      where rse2.team_id = p_team_id
        and rse2.raid_date = gs::date
        and rse2.exception_type = 'cancelled'
    )
  loop
    if p_in then
      insert into raid_rsvps (team_id, player_id, raid_date, status, note)
      values (p_team_id, p_player_id, v_date, 'Rotator-In', 'Officer-assigned for the week of ' || p_week_start)
      on conflict (team_id, player_id, raid_date)
      do update set status = 'Rotator-In', note = excluded.note, updated_at = now();
    else
      delete from raid_rsvps
      where team_id = p_team_id and player_id = p_player_id and raid_date = v_date
        and status = 'Rotator-In';
    end if;
  end loop;

  perform public.write_audit_log(
    p_team_id,
    'Rotator Week Assignment',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('week_start', p_week_start, 'in', p_in)
  );
end;
$function$;

create or replace function public.officer_set_rsvp(p_team_id integer, p_player_id integer, p_raid_date date, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_status is not null and p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not public.is_optional_raid_night(p_team_id, p_raid_date) then
    raise exception 'Attending is only valid on an optional raid night.';
  end if;

  if p_status is not null and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required so the raider knows why this was changed.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = p_player_id and raid_date = p_raid_date;
  else
    insert into raid_rsvps (team_id, player_id, raid_date, status, note)
    values (p_team_id, p_player_id, p_raid_date, p_status, p_note)
    on conflict (team_id, player_id, raid_date)
    do update set status = excluded.status, note = excluded.note, updated_at = now();
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Officer Set RSVP',
    'raid_rsvps',
    p_player_id,
    jsonb_build_object('raid_date', p_raid_date, 'status', p_status, 'note', p_note)
  );
end;
$function$;

create or replace function public.plan_raid_night(p_team_id integer, p_raid_date date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);
  v_count := public.fill_raid_night(p_team_id, p_raid_date);

  if v_count > 0 then
    perform public.write_audit_log(
      p_team_id,
      'Plan Raid Night',
      'raid_night_bosses',
      null,
      jsonb_build_object('raid_date', p_raid_date, 'bosses', v_count)
    );
  end if;

  return v_count;
end;
$function$;

create or replace function public.record_raid_night_participation(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'attendance')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from raid_night_bosses
    where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id
  ) then
    return 0;
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);

  delete from raid_night_participation
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_participation (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  return cardinality(p_player_ids);
end;
$function$;

create or replace function public.resolve_discord_display_name(p_actor_id uuid, p_team_id integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_display text;
begin
  if not (public.has_team_permission(p_team_id, 'edit_roster') or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_display
  from auth.users u
  where u.id = p_actor_id;

  return v_display;
end;
$function$;

create or replace function public.restore_player(p_player_id integer, p_name_realm text default NULL::text, p_nickname text default NULL::text, p_class_spec_id integer default NULL::integer, p_is_trial boolean default NULL::boolean, p_join_date date default NULL::date)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_name_realm text;
  v_restored boolean := false;
  v_spec_label text;
begin
  select team_id, team_member_id, name_realm
    into v_team_id, v_team_member_id, v_name_realm
    from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (public.has_team_permission(v_team_id, 'edit_roster')
          or public.is_guild_officer_of_team(v_team_id)
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- Asked about every linked character, not only one whose membership reads
  -- as archived: it locks the membership before the character is written, the
  -- order archive_team_member() takes, so an archive cannot land between this
  -- function's read and its update.
  if v_team_member_id is not null then
    v_restored := public.restore_team_member(v_team_id, v_team_member_id);
  end if;

  -- A blank field keeps what the character had. Only the spelling of the name
  -- may change, and the link must still be the one read above, or the
  -- membership just restored would belong to someone else.
  update public.players
     set name_realm = coalesce(nullif(p_name_realm, ''), name_realm),
         nickname = coalesce(nullif(p_nickname, ''), nickname),
         class_spec_id = coalesce(p_class_spec_id, class_spec_id),
         is_trial = coalesce(p_is_trial, is_trial),
         join_date = coalesce(p_join_date, join_date),
         is_bench = false,
         archived_at = null
   where id = p_player_id
     and archived_at is not null
     and name_realm_key = coalesce(lower(replace(nullif(p_name_realm, ''), ' ', '')), name_realm_key)
     and team_member_id is not distinct from v_team_member_id;

  if not found then
    if exists (select 1 from public.players where id = p_player_id and archived_at is null) then
      raise exception '% is already on the roster', v_name_realm;
    end if;
    raise exception 'That name is not this character''s, or the character changed while being re-added';
  end if;

  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.players p
    join public.classes_specs cs on cs.id = p.class_spec_id
   where p.id = p_player_id;

  perform public.write_audit_log(
    v_team_id, 'Player Added', 'players', p_player_id,
    to_jsonb(concat_ws(', ',
      coalesce(v_spec_label, 'Unknown spec'),
      're-added',
      case when v_restored then 'membership restored' end))
  );

  return v_restored;
end $function$;

create or replace function public.restore_team_member(p_team_id integer, p_team_member_id integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id integer;
  v_role text;
  v_archived_at timestamptz;
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- Locked, as in archive_team_member(), so a restore and an archive of the
  -- same person run one after the other, and two restores answer once.
  select team_id, role, archived_at into v_team_id, v_role, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  if v_archived_at is null then
    return false;
  end if;

  perform public.write_audit_log(
    p_team_id, 'team_member_restored', 'team_member', p_team_member_id,
    jsonb_build_object('role', 'raider', 'archived_role', v_role)
  );

  -- Back as a raider whatever role the archived row held, as through the
  -- invite link; a role above that is the team leader's to grant.
  update public.team_members set archived_at = null, role = 'raider' where id = p_team_member_id;
  return true;
end;
$function$;

create or replace function public.restrict_players_self_update_to_bonus_roll()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.has_team_permission(new.team_id, 'edit_roster')
     or public.is_guild_officer_of_team(new.team_id)
     or public.is_site_admin()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at' - 'name_realm_key') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $function$;

create or replace function public.review_main_swap_request(p_request_id integer, p_approve boolean, p_note text default NULL::text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.main_swap_requests%rowtype;
  v_from public.players%rowtype;
  v_player_id integer;
  v_spec_label text;
  v_note text := nullif(btrim(p_note), '');
  v_member_id integer;
  v_prior_member_id integer;
begin
  -- Read without a lock first, for the rows to lock below; the status is
  -- checked again once the request is held.
  select * into v_request from public.main_swap_requests where id = p_request_id;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;

  if not (public.has_team_permission(v_request.team_id, 'edit_roster')
          or public.is_guild_officer_of_team(v_request.team_id)
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  -- Rows are taken in an order that waits behind an archive instead of
  -- deadlocking with it (#1428): the membership, for share, which the share
  -- a removal or a signup add holds on it (#1432) does not block; then the
  -- new roster row,
  -- which a signup main swap writes before it archives the old character;
  -- then the old character; then the request, which the trigger cancelling a
  -- waiting swap reaches last.
  -- The raider is the person who asked (#1433), not whoever holds the old
  -- character now: a claim removed and taken by someone else while the swap
  -- waited would otherwise move the alt to them.
  select id into v_member_id from public.team_members
   where team_id = v_request.team_id and person_id = v_request.person_id and archived_at is null
     for share;
  if v_member_id is null then
    raise exception 'The raider who asked is no longer on this team';
  end if;
  select * into v_from from public.players where id = v_request.from_player_id;
  if v_from.team_member_id is distinct from v_member_id then
    raise exception '% is no longer linked to the raider who asked', v_from.name_realm;
  end if;

  if p_approve then
    -- A row by that name held by anyone else, on the roster or archived, is
    -- refused (#1433): the row carries that person's history, and only an
    -- officer can say whose the name is now. Held as the upsert below holds it.
    select team_member_id into v_prior_member_id
      from public.players
     where team_id = v_request.team_id
       and name_realm_key = lower(replace(v_request.name_realm, ' ', ''))
       for no key update;
    if v_prior_member_id is not null and v_prior_member_id <> v_member_id then
      raise exception '% is someone else''s character on this team', v_request.name_realm;
    end if;

    -- The character joins the roster, or comes back to it, as the raider's.
    -- Same on-conflict shape as add_signup_to_roster(): a character they
    -- played before keeps its id, so its loot and raid history stay attached
    -- to it.
    insert into public.players (
      team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
    )
    values (
      v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
      v_from.is_backup_tank, v_from.is_backup_healer, v_member_id
    )
    on conflict (team_id, name_realm_key) do update
      set class_spec_id = excluded.class_spec_id,
          is_trial = excluded.is_trial,
          join_date = excluded.join_date,
          is_backup_tank = excluded.is_backup_tank,
          is_backup_healer = excluded.is_backup_healer,
          team_member_id = excluded.team_member_id,
          -- The officer's wishlist and BiS exceptions were for the last stint
          -- (#1618), as a signup re-add and the invite link reset them.
          wishlist_allowed = case when players.archived_at is not null
                           then false else players.wishlist_allowed end,
          bis_allowed = case when players.archived_at is not null
                      then false else players.bis_allowed end,
          archived_at = null
    returning id into v_player_id;
  end if;

  select * into v_from from public.players where id = v_request.from_player_id for no key update;
  select * into v_request from public.main_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;
  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  if not p_approve then
    update public.main_swap_requests
       set status = 'declined', reviewed_at = now(), reviewed_by = public.my_person_id(), officer_note = v_note
     where id = p_request_id;

    -- Written here rather than through notify_player(), whose own check is
    -- the team's officers and site admins: a guild officer may review this.
    insert into public.notifications (team_id, player_id, message)
    values (v_request.team_id, v_request.from_player_id,
            concat('Your main swap to ', v_request.name_realm, ' was declined.',
                   case when v_note is not null then ' ' || v_note end));
    return null;
  end if;

  -- Reached only by a swap left waiting without the trigger (a restore with
  -- triggers off): the archive closes every other one first.
  if v_from.archived_at is not null then
    raise exception '% is no longer on the roster', v_from.name_realm;
  end if;

  -- The old character already renamed into the one asked for (the Roster
  -- tab's rename keeps the row): approving would archive the row it approved.
  if v_player_id = v_request.from_player_id then
    raise exception '% is already on the roster as their character', v_request.name_realm;
  end if;

  -- Approved before the old character is archived, so the trigger that cancels
  -- a waiting swap when its character leaves the roster finds this one closed.
  update public.main_swap_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = public.my_person_id(),
         officer_note = v_note, approved_player_id = v_player_id
   where id = p_request_id;

  -- The link stays on the archived character (#941): its attendance, loot and
  -- BoE finds still belong to this person, and step 5b's loot total reads it.
  update public.players set archived_at = now() where id = v_request.from_player_id;

  -- Attendance follows the raider, skipping any night the destination
  -- character already has its own row for (a character they played before).
  update public.attendance a set player_id = v_player_id
   where a.player_id = v_request.from_player_id
     and a.team_id = v_request.team_id
     and not exists (
       select 1 from public.attendance b
        where b.team_id = v_request.team_id
          and b.player_id = v_player_id
          and b.raid_date = a.raid_date
     );

  -- Audit (#1136): the same two lines a main swap through a signup writes, so
  -- both read alike in the Audit Log.
  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.classes_specs cs where cs.id = v_request.class_spec_id;

  perform public.write_audit_log(
    v_request.team_id, 'Player Added', 'players', v_player_id,
    to_jsonb(concat_ws(', ', coalesce(v_spec_label, 'Unknown spec'), 'main swap from ' || v_from.name_realm))
  );
  perform public.write_audit_log(
    v_request.team_id, 'Main Swap: Old Character Removed', 'players', v_request.from_player_id,
    to_jsonb('Replaced by ' || v_request.name_realm)
  );

  insert into public.notifications (team_id, player_id, message)
  values (v_request.team_id, v_player_id,
          concat('Your main swap to ', v_request.name_realm, ' was approved.',
                 case when v_note is not null then ' ' || v_note end));

  return v_player_id;
end;
$function$;

create or replace function public.set_boss_group(p_team_id integer, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] default NULL::integer[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current integer[];
  v_nights date[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this group since you opened it. Reload to see their change.';
  end if;

  delete from boss_groups where team_id = p_team_id and encounter_id = p_encounter_id;
  insert into boss_groups (team_id, encounter_id, player_id)
  select p_team_id, p_encounter_id, x from unnest(p_player_ids) x;

  select coalesce(array_agg(raid_date order by raid_date), '{}') into v_nights
  from raid_night_bosses
  where team_id = p_team_id and encounter_id = p_encounter_id
    and raid_date >= public.raid_today() and confirmed_at is null and not skipped;

  delete from raid_night_lineups
  where team_id = p_team_id and encounter_id = p_encounter_id and raid_date = any (v_nights);
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, d, p_encounter_id, x
  from unnest(v_nights) d, unnest(p_player_ids) x
  join players p on p.id = x and not p.is_bench;

  perform public.write_audit_log(
    p_team_id,
    'Set Boss Group',
    'boss_groups',
    p_encounter_id,
    jsonb_build_object(
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'nights_following', to_jsonb(v_nights)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;

create or replace function public.set_lineup_role_targets(p_team_id integer, p_tanks integer, p_healers integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_tanks < 0 or p_tanks > 20 or p_healers < 0 or p_healers > 20 then
    raise exception 'Role targets have to be between 0 and 20.';
  end if;

  insert into team_lineup_settings (team_id, tanks_wanted, healers_wanted, updated_at)
  values (p_team_id, p_tanks, p_healers, now())
  on conflict (team_id) do update set tanks_wanted = excluded.tanks_wanted, healers_wanted = excluded.healers_wanted, updated_at = excluded.updated_at;

  perform public.write_audit_log(
    p_team_id,
    'Set Lineup Role Targets',
    'team_lineup_settings',
    p_team_id,
    jsonb_build_object('tanks_wanted', p_tanks, 'healers_wanted', p_healers)
  );
end;
$function$;

create or replace function public.set_raid_night_boss_skipped(p_team_id integer, p_raid_date date, p_encounter_id integer, p_skipped boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_skipped is null then
    raise exception 'Say whether the boss is skipped.';
  end if;

  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  update raid_night_bosses
     set skipped = p_skipped, skipped_for_kill_id = null, confirmed_at = null, confirmed_by = null
   where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not found then
    raise exception 'That boss is not on this night''s plan.';
  end if;

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if not p_skipped then
    insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
    select p_team_id, p_raid_date, p_encounter_id, g.player_id
    from boss_groups g
    join players p on p.id = g.player_id and p.archived_at is null and not p.is_bench
    where g.team_id = p_team_id and g.encounter_id = p_encounter_id;
  end if;

  perform public.write_audit_log(
    p_team_id,
    case when p_skipped then 'Skip Raid Night Boss' else 'Unskip Raid Night Boss' end,
    'raid_night_bosses',
    p_encounter_id,
    jsonb_build_object('raid_date', p_raid_date, 'boss', (select name from raid_encounters where id = p_encounter_id))
  );
end;
$function$;

create or replace function public.set_raid_night_lineup(p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] default NULL::integer[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current integer[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    public.has_team_permission(p_team_id, 'edit_schedule')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_raid_date is null or not coalesce((select i.exists from public.raid_night_info(p_team_id, p_raid_date) i), false) then
    raise exception 'There is no raid that night.';
  end if;

  if not exists (select 1 from raid_encounters where id = p_encounter_id) then
    raise exception 'That boss is not in the raid list yet.';
  end if;

  perform public.check_lineup_players(p_team_id, p_player_ids);
  perform pg_advisory_xact_lock(hashtext('boss_lineup'), p_team_id);

  select coalesce(array_agg(player_id), '{}') into v_current
  from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;

  if p_expected_player_ids is not null and not public.same_player_set(v_current, p_expected_player_ids) then
    raise exception 'Someone else changed this boss''s lineup since you opened it. Reload to see their change.';
  end if;

  insert into raid_night_bosses (team_id, raid_date, encounter_id, position, confirmed_at, confirmed_by)
  values (
    p_team_id, p_raid_date, p_encounter_id,
    coalesce((select max(position) from raid_night_bosses where team_id = p_team_id and raid_date = p_raid_date), 0) + 1,
    now(), public.my_person_id()
  )
  on conflict (team_id, raid_date, encounter_id)
  do update set skipped = false, skipped_for_kill_id = null, confirmed_at = now(), confirmed_by = public.my_person_id();

  delete from raid_night_lineups
  where team_id = p_team_id and raid_date = p_raid_date and encounter_id = p_encounter_id;
  insert into raid_night_lineups (team_id, raid_date, encounter_id, player_id)
  select p_team_id, p_raid_date, p_encounter_id, x from unnest(p_player_ids) x;

  perform public.write_audit_log(
    p_team_id,
    'Set Raid Night Lineup',
    'raid_night_lineups',
    p_encounter_id,
    jsonb_build_object(
      'raid_date', p_raid_date,
      'boss', (select name from raid_encounters where id = p_encounter_id),
      'player_ids', to_jsonb(p_player_ids),
      'was', to_jsonb(v_current)
    )
  );

  return cardinality(p_player_ids);
end;
$function$;

create or replace function public.team_battlenet_connections(p_team_id integer)
returns TABLE(team_member_id integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
    or public.is_guild_officer_of_team(p_team_id)
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select tm.id
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and pe.auth_user_id is not null
    and exists (
      select 1
      from auth.identities i
      where i.user_id = pe.auth_user_id
        and i.provider = 'custom:battlenet'
    )
  order by tm.id;
end;
$function$;

create or replace function public.team_invite_link_reset(p_team_id integer, p_expires_at timestamp with time zone default NULL::timestamp with time zone)
returns team_invite_links
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text;
  v_row public.team_invite_links;
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
    or public.is_guild_officer_of_team(p_team_id)
  ) then
    raise exception 'Not authorized';
  end if;

  select slug into v_slug from public.teams where id = p_team_id;
  if v_slug is null then
    raise exception 'Team not found';
  end if;

  insert into public.team_invite_links (team_id, code, expires_at)
  values (p_team_id, v_slug || '-' || public.new_url_code(), p_expires_at)
  on conflict (team_id) do update
    set code = excluded.code,
        expires_at = excluded.expires_at
  returning * into v_row;

  perform public.write_audit_log(p_team_id, 'Invite Link Reset', 'team_invite_links', p_team_id, jsonb_build_object('expires_at', p_expires_at));

  return v_row;
end;
$function$;

create or replace function public.team_invite_link_revoke(p_team_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
    or public.is_guild_officer_of_team(p_team_id)
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.team_invite_links where team_id = p_team_id;

  perform public.write_audit_log(p_team_id, 'Invite Link Revoked', 'team_invite_links', p_team_id, '{}'::jsonb);
end;
$function$;

create or replace function public.team_rsvp_answers(p_team_id integer, p_from date, p_to date)
returns TABLE(player_id integer, raid_date date, status text, updated_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    exists (
      select 1 from players p
      where p.team_id = p_team_id
        and p.id = any (public.my_active_player_ids())
    )
    or public.has_team_permission(p_team_id, 'see_rsvps')
    or public.is_guild_officer_of_team(p_team_id)
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.';
  end if;

  return query
    select r.player_id, r.raid_date, r.status, r.updated_at
    from raid_rsvps r
    where r.team_id = p_team_id
      and r.raid_date between p_from and p_to
    order by r.raid_date, r.player_id;
end;
$function$;

create or replace function public.team_unnamed_members(p_team_id integer)
returns TABLE(team_member_id integer, discord_name text, battletag text, character_name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- Whoever can Assign: the team's officers, a site admin, or a guild officer
  -- of this team's own guild. is_guild_officer() would answer for a guild
  -- officer anywhere and hand one guild's sign-in names to another (#1643's
  -- rule, CodeRabbit on this function).
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
    or exists (select 1 from public.teams t where t.id = p_team_id and public.is_guild_officer_of(t.guild_id))
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    -- An empty name counts as none, as the app reads its own sign-in.
    (select coalesce(nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
                     nullif(i.identity_data ->> 'full_name', ''),
                     nullif(i.identity_data ->> 'name', ''))
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'discord'
      order by i.created_at desc
      limit 1),
    (select nullif(i.identity_data -> 'custom_claims' ->> 'battletag', '')
       from auth.identities i
      where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
      order by i.created_at desc
      limit 1),
    (select p.name_realm
       from public.players p
      -- On this team too, not only linked to the membership (CodeRabbit).
      where p.team_member_id = tm.id and p.team_id = tm.team_id and p.archived_at is null
      order by p.id
      limit 1)
  from public.team_members tm
  join public.people pe on pe.id = tm.person_id
  where tm.team_id = p_team_id
    and tm.archived_at is null
    and not exists (select 1 from public.names n where n.team_member_id = tm.id)
  order by tm.id;
end;
$function$;

create or replace function public.resolve_person(p_discord_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean := p_discord_id is not distinct from public.current_discord_id();
  v_is_site_admin boolean := public.is_site_admin();
  v_guild_team_ids integer[] := public.my_guild_officer_team_ids();
  v_sees_all_teams boolean;
  v_person people%rowtype;
  v_grants text[];
  v_result jsonb;
begin
  v_sees_all_teams := v_is_self or v_is_site_admin;

  if not (v_sees_all_teams or cardinality(public.my_permission_team_ids('edit_roster')) > 0 or cardinality(v_guild_team_ids) > 0) then
    raise exception 'Not authorized';
  end if;

  select * into v_person from people where discord_id = p_discord_id;

  select coalesce(array_agg(g.grant_type), '{}') into v_grants
    from guild_grants g
   where g.person_id = v_person.id;

  if p_discord_id is null
     or not (
       exists (select 1 from team_members where person_id = v_person.id)
       or cardinality(v_grants) > 0
     ) then
    return null;
  end if;

  select jsonb_build_object(
    'discord_id', p_discord_id,
    'auth_user_id', v_person.auth_user_id,
    'site_admin', case when v_is_self or v_is_site_admin
                       then 'site_admin' = any (v_grants) end,
    'guild_officer', case when v_is_self or v_is_site_admin
                          then 'guild_officer' = any (v_grants) end,
    -- Shown to the callers who saw it before #1646 opened this function to
    -- edit_roster: BoE Manager is a guild grant, the next issue's to move.
    'boe_manager', ('boe_manager' = any (v_grants))
                   and (v_sees_all_teams or public.is_any_team_officer() or cardinality(v_guild_team_ids) > 0),
    'teams', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'team_id', tm.team_id,
                 'team_member_id', tm.id,
                 'role', tm.role,
                 'archived_at', tm.archived_at,
                 'characters', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'player_id', p.id,
                              'name_realm', p.name_realm,
                              'url_code', p.url_code,
                              'archived_at', p.archived_at
                            )
                            order by p.archived_at desc nulls first, p.name_realm
                          )
                     from players p
                    where p.team_member_id = tm.id
                 ), '[]'::jsonb)
               )
               order by tm.team_id
             )
        from team_members tm
       where tm.person_id = v_person.id
         and (v_sees_all_teams
              or tm.team_id = any (v_guild_team_ids)
              or public.has_team_permission(tm.team_id, 'edit_roster'))
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.write_audit_log(p_team_id integer, p_action text, p_target_type text default NULL::text, p_target_id integer default NULL::integer, p_detail jsonb default NULL::jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (exists (select 1 from public.rank_permissions k
                  where k.permission in ('edit_roster', 'edit_schedule', 'attendance', 'manage_signups',
                                         'manage_loot', 'pay_boe_cuts', 'promote_assistants')
                    and public.has_team_permission(p_team_id, k.permission)) or public.is_site_admin() or public.is_guild_officer_of_team(p_team_id)) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$function$;

