-- #1428: a waiting main swap is closed when the character it is from
-- leaves the roster.
--
-- Once that character is archived, review_main_swap_request() could never
-- approve the swap, yet it stayed in the officers' queue: Approve failed and
-- Decline sent a "declined" note to someone who had left, or about a swap
-- already done by hand. Four paths archive a character: the Roster tab's
-- Remove (archive_player()), Archive Member (archive_team_member()), a main
-- swap through a season signup (add_signup_to_roster()), and an officer's
-- direct update. A trigger on players.archived_at covers all four, the shape
-- #1392 used for the live priority lists.
--
-- A swap to a character that is on the roster by then was done another way
-- (a signup main swap to the same alt, or by hand), so it closes as approved
-- with no notification. Any other waiting swap is cancelled with the acting
-- officer as reviewer and a note saying why: "Membership ended" when the
-- character's membership is archived (archive_team_member() archives the
-- membership before its characters), with no notification, since they left;
-- "Character removed" otherwise, with a notification to the raider on the
-- archived character, which their inbox still reads, unless nobody holds the
-- character any more. Security definer: main_swap_requests and notifications
-- have no write rule for the officer whose archive fires it.
--
-- Approving a swap archives its own old character, so the approval now marks
-- the request approved first. Archive Member locks the membership, then the
-- characters, then (through the trigger) the request; Remove and a signup
-- main swap lock the character, then the request, and take only a key share
-- on the membership. The review takes the membership for share, then the new
-- roster row, then the old character, then the request, so it waits behind
-- any of them instead of deadlocking. request_main_swap() holds the character
-- it checked until the request is saved.

create or replace function public.cancel_waiting_main_swaps_on_archive() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_membership_ended boolean;
begin
  -- The character they asked for is on the roster now: the swap was done
  -- another way, by a signup main swap or by hand.
  update main_swap_requests r
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = my_person_id(),
         officer_note = 'Already on the roster',
         approved_player_id = a.id
    from players a
   where r.from_player_id = new.id
     and r.team_id = new.team_id
     and r.status = 'pending'
     and a.team_id = new.team_id
     and a.name_realm_key = lower(replace(r.name_realm, ' ', ''))
     and a.archived_at is null;

  select tm.archived_at is not null into v_membership_ended
    from team_members tm
   where tm.id = new.team_member_id;
  v_membership_ended := coalesce(v_membership_ended, false);

  with cancelled as (
    update main_swap_requests
       set status = 'cancelled',
           reviewed_at = now(),
           reviewed_by = my_person_id(),
           officer_note = case when v_membership_ended then 'Membership ended' else 'Character removed' end
     where from_player_id = new.id
       and team_id = new.team_id
       and status = 'pending'
    returning name_realm
  )
  insert into notifications (team_id, player_id, message)
  select new.team_id, new.id,
         concat('Your main swap to ', c.name_realm, ' was cancelled: ', new.name_realm, ' is no longer on the roster.')
    from cancelled c
   where not v_membership_ended
     and new.team_member_id is not null;

  return new;
end;
$$;

revoke all on function public.cancel_waiting_main_swaps_on_archive() from public, anon, authenticated;

create trigger players_cancel_waiting_main_swaps_on_archive
  after update of archived_at on public.players
  for each row
  when (old.archived_at is null and new.archived_at is not null)
  execute function public.cancel_waiting_main_swaps_on_archive();

-- A swap already waiting from a character off the roster (none on
-- production, 2026-10-03) is closed the way the trigger would have, since the
-- review no longer refuses one.
update public.main_swap_requests r
   set status = 'cancelled',
       reviewed_at = now(),
       officer_note = case when tm.archived_at is not null then 'Membership ended' else 'Character removed' end
  from public.players p
  left join public.team_members tm on tm.id = p.team_member_id
 where p.id = r.from_player_id
   and p.archived_at is not null
   and r.status = 'pending';

CREATE OR REPLACE FUNCTION public.review_main_swap_request(p_request_id integer, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.main_swap_requests%rowtype;
  v_from public.players%rowtype;
  v_player_id integer;
  v_spec_label text;
  v_note text := nullif(btrim(p_note), '');
begin
  -- Read without a lock first, for the rows to lock below; the status is
  -- checked again once the request is held.
  select * into v_request from public.main_swap_requests where id = p_request_id;
  if not found then
    raise exception 'No main swap with id %', p_request_id;
  end if;

  if not (coalesce(public.my_team_role(v_request.team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'That main swap was already %', v_request.status;
  end if;

  -- Rows are taken in an order that waits behind an archive instead of
  -- deadlocking with it (#1428): the membership, for share, which the key
  -- share a removal takes on it does not block; then the new roster row,
  -- which a signup main swap writes before it archives the old character;
  -- then the old character; then the request, which the trigger cancelling a
  -- waiting swap reaches last.
  perform 1 from public.team_members
   where id = (select team_member_id from public.players where id = v_request.from_player_id)
     for share;
  select * into v_from from public.players where id = v_request.from_player_id;

  if p_approve then
    -- The character joins the roster, or comes back to it. Same on-conflict
    -- shape as add_signup_to_roster(): a character they played before keeps its
    -- id, so its loot and raid history stay attached to it.
    insert into public.players (
      team_id, name_realm, class_spec_id, is_trial, join_date, is_backup_tank, is_backup_healer, team_member_id
    )
    values (
      v_request.team_id, v_request.name_realm, v_request.class_spec_id, v_from.is_trial, v_from.join_date,
      v_from.is_backup_tank, v_from.is_backup_healer, v_from.team_member_id
    )
    on conflict (team_id, name_realm_key) do update
      set class_spec_id = excluded.class_spec_id,
          is_trial = excluded.is_trial,
          join_date = excluded.join_date,
          is_backup_tank = excluded.is_backup_tank,
          is_backup_healer = excluded.is_backup_healer,
          team_member_id = coalesce(players.team_member_id, excluded.team_member_id),
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

CREATE OR REPLACE FUNCTION public.request_main_swap(p_team_id integer, p_character_id integer, p_class_spec_id integer, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_person_id integer := public.my_person_id();
  v_character public.characters%rowtype;
  v_from_player_id integer;
  v_spec_class text;
  v_request_id integer;
begin
  if v_person_id is null then
    raise exception 'Not signed in';
  end if;

  select * into v_character from public.characters
   where id = p_character_id and person_id = v_person_id;
  if not found then
    raise exception 'That character is not on your account';
  end if;

  select p.id into v_from_player_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
   where p.team_id = p_team_id
     and p.archived_at is null
     and tm.archived_at is null
     and tm.person_id = v_person_id
   order by p.id
   limit 1
  -- Held until the request is saved, so a removal cannot take the character
  -- off the roster between this check and the insert and leave a swap
  -- waiting from it (#1428). Only the character: locking the membership here
  -- too would take it after the character, the opposite of Archive Member.
     for share of p;
  if v_from_player_id is null then
    raise exception 'You have no character on this team''s roster';
  end if;

  if exists (
    select 1 from public.players p
     where p.team_id = p_team_id
       and p.archived_at is null
       and p.name_realm_key = v_character.name_realm_key
  ) then
    raise exception '% is already on this roster', v_character.name_realm;
  end if;

  select cs.class into v_spec_class from public.classes_specs cs where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec';
  end if;
  if v_character.class_name is not null and v_spec_class is distinct from v_character.class_name then
    raise exception '% is a %, not a %', v_character.name, v_character.class_name, v_spec_class;
  end if;

  if exists (
    select 1 from public.main_swap_requests r
     where r.team_id = p_team_id and r.person_id = v_person_id and r.status = 'pending'
  ) then
    raise exception 'You already have a main swap waiting for an officer';
  end if;

  insert into public.main_swap_requests (
    team_id, person_id, from_player_id, character_id, name_realm, class_spec_id, note
  )
  values (
    p_team_id, v_person_id, v_from_player_id, p_character_id,
    v_character.name_realm, p_class_spec_id, nullif(btrim(p_note), '')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

comment on table public.main_swap_requests is
  'A raider''s request to make one of their alts their roster character, outside a signup window (#631, #942 step 5c). Written only by request_main_swap(), cancel_main_swap_request() and review_main_swap_request(), and by the trigger that closes a waiting swap when its character leaves the roster (cancel_waiting_main_swaps_on_archive, #1428). name_realm and class_spec_id are what they asked for, kept here so the request still reads right after the character row changes.';
