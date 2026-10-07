-- #1432: Remove and a signup add take the membership before the character.
--
-- Archive Member locks the membership, then each of the person's characters.
-- Remove (archive_player) and a signup add (add_signup_to_roster) took the
-- character first and reached the membership last, through the foreign keys
-- on removal_reasons.team_member_id and the new character's team_member_id.
-- When the two ran on the same raider at once, each waited on the other and
-- Postgres cancelled one with "deadlock detected". Now both hold the
-- membership first, so one waits behind the other.
--
-- The hold is its own function, run as its owner. Both callers run with the
-- officer's own rights, and a share lock on a membership row needs its UPDATE
-- policy, which only team leaders and site admins pass: for a plain officer
-- the lock would match no row and hold nothing. It is gated like
-- archive_player(), and it also lets a call with nobody signed in through,
-- which only the database owner can make, since a signup add made that way
-- has always worked. Holding a row for share changes nothing in it.
--
-- Being able to wait has two consequences. A signup main swap that waited
-- behind Archive Member finds the old character already off the roster, and
-- leaves the date it left alone, since its removal reason is keyed on that
-- date. And a signer archived while the add waited is brought back, as if the
-- archive had landed first (#1402).

create function public.hold_team_member(p_team_member_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_team_id integer;
begin
  if p_team_member_id is null then
    return;
  end if;

  select team_id into v_team_id from public.team_members where id = p_team_member_id;
  if v_team_id is null
     or not (auth.uid() is null
             or v_team_id = any (public.my_officer_team_ids())
             or public.is_guild_officer()
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  perform 1 from public.team_members where id = p_team_member_id for share;
end;
$$;

alter function public.hold_team_member(integer) owner to postgres;

comment on function public.hold_team_member(integer) is
  'Holds a team_members row for share until the caller''s transaction ends (#1432), so archive_player() and add_signup_to_roster() take the membership before the character, the order archive_team_member() takes. Runs as its owner because both callers run with the officer''s rights, and an officer''s own share lock on a membership matches no row. Gated like archive_player(), plus a call with nobody signed in, which only the database owner can make; a null id does nothing. Writes nothing.';

revoke all on function public.hold_team_member(integer) from public;
revoke execute on function public.hold_team_member(integer) from anon;
grant execute on function public.hold_team_member(integer) to authenticated;

CREATE OR REPLACE FUNCTION public.archive_player(p_player_id integer, p_reason text, p_detail text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_archived_at timestamptz;
begin
  select team_id, team_member_id into v_team_id, v_team_member_id from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
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

CREATE OR REPLACE FUNCTION public.add_signup_to_roster(p_signup_id integer, p_is_trial boolean DEFAULT true, p_archive_player_id integer DEFAULT NULL::integer, p_is_backup_tank boolean DEFAULT false, p_is_backup_healer boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
begin
  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
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

  if v_signup.auth_user_id is not null then
    select tm.id, tm.archived_at is not null into v_signer_member_id, v_signer_archived
      from public.team_members tm
      join public.people pe on pe.id = tm.person_id
     where tm.team_id = v_signup.team_id and pe.auth_user_id = v_signup.auth_user_id;
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
  -- of deadlocking with it.
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
