-- #1402: an officer adding an archived person's season signup brings them
-- back, as a raider.
--
-- Option 2 on #1355 (2026-10-02): any officer action brings an archived
-- member back, and nothing the person does on their own does.
-- add_signup_to_roster() brought the character back and left the membership
-- archived, so the person sat on the roster with no role on the team.
--
-- The add runs with the officer's own rights, and officers cannot change a
-- membership's archived_at (the trigger below refuses it from authenticated).
-- So the restore is its own function, run as its owner and gated like
-- archive_team_member(). The add can only call a function the officer can
-- execute, so it is granted to authenticated like archive; called directly,
-- it does only what Option 2 lets an officer do anyway.

create function public.restore_team_member(p_team_id integer, p_team_member_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_team_id integer;
  v_archived_at timestamptz;
begin
  if not (
    p_team_id = any (public.my_officer_team_ids())
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  -- Locked, as in archive_team_member(), so a restore and an archive of the
  -- same person run one after the other.
  select team_id, archived_at into v_team_id, v_archived_at
    from public.team_members where id = p_team_member_id
    for update;
  if v_team_id is null or v_team_id <> p_team_id then
    raise exception 'That membership is not on this team';
  end if;

  if v_archived_at is null then
    return;
  end if;

  perform public.write_audit_log(
    p_team_id, 'team_member_restored', 'team_member', p_team_member_id,
    jsonb_build_object('role', 'raider')
  );

  -- Back as a raider whatever role the archived row held, as through the
  -- invite link; a role above that is the team leader's to grant.
  update public.team_members set archived_at = null, role = 'raider' where id = p_team_member_id;
end;
$$;

alter function public.restore_team_member(integer, integer) owner to postgres;

comment on function public.restore_team_member(integer, integer) is
  'Officer-only: brings an archived team_members row back as a raider (#1402), whatever role it held, and writes a team_member_restored audit entry. Characters stay as they are: the caller brings back the one it adds. A membership that is not archived is left alone and nothing is logged. Called by add_signup_to_roster() when the signer''s membership is archived (Option 2 on #1355: any officer action brings an archived member back).';

revoke all on function public.restore_team_member(integer, integer) from public;
revoke execute on function public.restore_team_member(integer, integer) from anon;
grant execute on function public.restore_team_member(integer, integer) to authenticated;

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
  v_spec_label text;
  v_archived_name_realm text;
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

  -- An officer adding the signup brings an archived signer back (#1402).
  -- Before the character is written, so the membership is locked before the
  -- character, the order archive_team_member() and the invite link take.
  if v_signer_archived then
    perform public.restore_team_member(v_signup.team_id, v_signer_member_id);
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
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id;

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
  -- write_audit_log() needs an actor and would otherwise abort the add.
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
        case when v_signer_archived then 'membership restored' end))
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

CREATE OR REPLACE FUNCTION public.team_members_archived_at_through_functions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at then
    raise exception 'A membership is archived through Archive Member and restored when an officer brings the person back, not by editing it';
  end if;
  return new;
end;
$function$;

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared when an officer brings them back: team_invite_link_join(), or restore_team_member() when an officer adds their season signup (#1402). Nothing changes it any other way: a direct update of the column is refused (team_members_archived_at_through_functions). Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row; my_player_ids() and earlier_characters() still read it, since that is the history.';
