-- Function public.add_signup_to_roster: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

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
