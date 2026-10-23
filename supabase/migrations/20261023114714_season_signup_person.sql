-- #1465 (part of #1342): a season signup records who signed up and which of
-- their characters.
--
-- A signup has been a name typed on a sheet: the character as text and the
-- signer's account id, with nothing pointing at the person or a character
-- they own. Signing up becomes a signed-in person declaring which of their
-- saved (Battle.net-confirmed) characters they will main next tier, and in the
-- new app it goes straight onto the Projected Roster with no approval step
-- (Kat, 2026-10-23). Until cutover the current site's Signups tab and Pending
-- Roster keep working, so a declared signup is stored as 'pending' like any
-- other.
--
-- One signup per person per team per tier while it is not rejected; signing
-- up again replaces it. The rule covers rows that carry a person, which is
-- every declared signup. Rows from submit_season_signup() carry none and are
-- left as they are: two signers on Hellfire have two 'added' rows each for
-- MID2 from June and July, so filling person_id in would break the rule.
-- declare_season_signup() still finds such a row by the signer's account and
-- replaces it, unless it is already on the roster.

alter table public.season_signups
  add column person_id integer references public.people (id) on delete set null,
  add column character_id integer references public.characters (id) on delete set null,
  add column is_trial boolean,
  add column is_backup_tank boolean not null default false,
  add column is_backup_healer boolean not null default false;

comment on column public.season_signups.person_id is
  'The person who signed up (#1465). Set by declare_season_signup(); null on rows submit_season_signup() wrote, which carry auth_user_id instead.';
comment on column public.season_signups.character_id is
  'The saved character the signer picked (#1465). Emptied if that character row goes, for example when the person chooses alts again (#1430); signup_name_realm stays the name of record.';
comment on column public.season_signups.is_trial is
  'The officer''s Trial flag from the Projected Roster (#1342), applied when signups close (#1467). Null until an officer sets it.';
comment on column public.season_signups.is_backup_tank is
  'The officer''s backup-tank flag from the Projected Roster (#1342), applied when signups close (#1467).';
comment on column public.season_signups.is_backup_healer is
  'The officer''s backup-healer flag from the Projected Roster (#1342), applied when signups close (#1467).';

create unique index season_signups_one_per_person
  on public.season_signups (person_id, team_id, season)
  where status <> 'rejected';

-- The signed-in person signs up for a team's coming tier with one of their own
-- saved characters, while that tier's signups are open and before it starts. Ownership is proved the way
-- request_main_swap() proves it: the character row must be theirs. When they
-- already have a different character on this team's roster, the signup is a
-- main swap from it, stored the way submit_season_signup() stores one so the
-- current site reads it alike. Signing up again replaces their signup for the
-- tier, including one the current site took from the same account, unless an
-- officer has already put it on the roster.
create or replace function public.declare_season_signup(
  p_team_id integer,
  p_season text,
  p_character_id integer,
  p_class_spec_id integer,
  p_off_specs text default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_spec_class text;
  v_current text;
  v_swap boolean;
  v_existing public.season_signups%rowtype;
  v_id integer;
begin
  if v_uid is null or v_person_id is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.team_seasons ts
     where ts.team_id = p_team_id and ts.season_code = p_season and ts.signups_open
  ) then
    raise exception 'signups are not open for that season on this team';
  end if;

  -- Signups are for the coming tier only and close before it starts (Kat,
  -- 2026-10-23), so a tier already under way is refused even while its
  -- switch is still on, as MID2's is on two teams today.
  if exists (
    select 1 from public.seasons se
     where se.code = p_season
       and se.starts_at <= (now() at time zone 'America/New_York')::date
  ) then
    raise exception 'That season has already started; signups are for the next one';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select cs.class into v_spec_class from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  -- Their character on this team's roster now, if any.
  select p.name_realm into v_current
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and tm.archived_at is null
     and tm.person_id = v_person_id
   order by p.id
   limit 1;
  v_swap := v_current is not null and lower(replace(v_current, ' ', '')) <> v_character.name_realm_key;

  -- Their signup for the tier already, by person or, for one the current site
  -- took, by account. An added one first, so it is never passed over.
  select * into v_existing
    from public.season_signups s
   where s.team_id = p_team_id
     and s.season = p_season
     and s.status <> 'rejected'
     and (s.person_id = v_person_id or (s.person_id is null and s.auth_user_id = v_uid))
   order by s.status = 'added' desc, s.id
   limit 1
     for update;

  if found and v_existing.status = 'added' then
    raise exception 'You are already on this season''s roster for this team. Ask one of its officers to change your signup.';
  end if;

  if found then
    update public.season_signups
       set person_id = v_person_id,
           character_id = v_character.id,
           auth_user_id = v_uid,
           signup_name_realm = v_character.name_realm,
           class_spec_id = case when v_swap then null else p_class_spec_id end,
           main_swap = v_swap,
           swap_class_spec_id = case when v_swap then p_class_spec_id end,
           swap_from_name_realm = case when v_swap then v_current end,
           off_specs = nullif(btrim(p_off_specs), ''),
           player_note = nullif(btrim(p_note), ''),
           status = 'pending',
           submitted_at = now(),
           reviewed_at = null,
           reviewed_by = null
     where id = v_existing.id
    returning id into v_id;
    return v_id;
  end if;

  -- None yet. The unique index settles two first signups racing each other:
  -- the second replaces the first, as a later signup would.
  insert into public.season_signups (
    team_id, season, person_id, character_id, auth_user_id, signup_name_realm,
    class_spec_id, main_swap, swap_class_spec_id, swap_from_name_realm,
    off_specs, player_note, status
  )
  values (
    p_team_id, p_season, v_person_id, v_character.id, v_uid, v_character.name_realm,
    case when v_swap then null else p_class_spec_id end, v_swap,
    case when v_swap then p_class_spec_id end, case when v_swap then v_current end,
    nullif(btrim(p_off_specs), ''), nullif(btrim(p_note), ''), 'pending'
  )
  on conflict (person_id, team_id, season) where status <> 'rejected' do update
     set character_id = excluded.character_id,
         signup_name_realm = excluded.signup_name_realm,
         class_spec_id = excluded.class_spec_id,
         main_swap = excluded.main_swap,
         swap_class_spec_id = excluded.swap_class_spec_id,
         swap_from_name_realm = excluded.swap_from_name_realm,
         off_specs = excluded.off_specs,
         player_note = excluded.player_note,
         submitted_at = now()
   where season_signups.status <> 'added'
  returning id into v_id;

  if v_id is null then
    raise exception 'You are already on this season''s roster for this team. Ask one of its officers to change your signup.';
  end if;
  return v_id;
end;
$$;

revoke all on function public.declare_season_signup(integer, text, integer, integer, text, text) from public, anon;
grant execute on function public.declare_season_signup(integer, text, integer, integer, text, text) to authenticated;

-- add_signup_to_roster(): the signer is the signup's person when it has one,
-- else the account as before, and a new character from a declared signup is
-- linked to the signer's membership. A typed signup's character still waits
-- for a claim or the Battle.net link, as today.
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
  -- waiting for a claim. A row someone else holds is left alone.
  if v_signup.character_id is not null and v_signer_member_id is not null then
    update public.players set team_member_id = v_signer_member_id
     where id = v_player_id and team_member_id is null;
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
