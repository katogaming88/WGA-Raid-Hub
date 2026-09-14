-- #1136: log roster adds from the Pending Roster tab.
--
-- add_signup_to_roster() added and archived characters without writing
-- anything to audit_log. The Apps Script pipeline it replaced logged "Roster
-- Push: Added" and "Main Swap: Old Character Removed"; since the move to
-- Supabase (#328) neither the function nor the page did, so 57 adds on
-- production after 2026-06-30, 16 of them main swaps, have no audit entry
-- (found 2026-09-13 looking for Sgtgigachad-Dalaran's swap to Glizzygary). Those
-- cannot be backfilled: nothing recorded which officer made them.
--
-- The function now writes "Player Added" for the added or revived character
-- and, on a main swap, "Main Swap: Old Character Removed" for the archived
-- one. Logged in the function rather than the page so the single and batch
-- add buttons, and any future caller, are covered alike. The body is otherwise
-- unchanged from 20260913182610_resolve_person_and_kept_character_links.sql.

create or replace function public.add_signup_to_roster(
  p_signup_id integer,
  p_is_trial boolean default true,
  p_archive_player_id integer default null::integer,
  p_is_backup_tank boolean default false,
  p_is_backup_healer boolean default false
)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
  v_archived_team_member_id integer;
  v_archived_join_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_live_season text;
  v_prior_archived_at timestamptz;
  v_prior_team_member_id integer;
  v_signer_member_id integer;
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
    select tm.id into v_signer_member_id
      from public.team_members tm
     where tm.team_id = v_signup.team_id and tm.auth_user_id = v_signup.auth_user_id;
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

    -- Drop the archived character's standing priority_order rows for the
    -- live season only, same as remove_player_priority_order() -- they no
    -- longer belong on the roster, so they shouldn't keep occupying a slot
    -- in the Priority tab, RCLootCouncil export, or addon panel.
    select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
      into v_live_season
      from public.team_settings ts
     where ts.team_id = v_signup.team_id;

    if v_live_season is not null then
      delete from public.priority_order
       where team_id = v_signup.team_id
         and season = v_live_season
         and player_id = p_archive_player_id;
    end if;
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
        case when v_archived_name_realm is not null then 'main swap from ' || v_archived_name_realm end))
    );

    if v_archived_name_realm is not null then
      perform public.write_audit_log(
        v_signup.team_id, 'Main Swap: Old Character Removed', 'players', p_archive_player_id,
        to_jsonb('Replaced by ' || v_signup.signup_name_realm)
      );
    end if;
  end if;

  return v_player_id;
end $$;
