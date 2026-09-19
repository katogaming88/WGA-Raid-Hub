-- #757: a second Mark Received of the same item, slot and track is refused
-- while the first is pending or approved.
--
-- A raider who did not see the confirmation clicked again and both rows
-- landed; with auto-approval both were approved with no officer in between
-- (8 exact duplicate approved rows across 4 players on prod, 2026-08-25).
-- submit_bis_link() had the same hole until 20260810224022 added its
-- pending check; this is the same protection for self-received reports.
--
-- The key is character, item, slot and track, not character and item: a
-- placeholder item (M+, Crafted, Catalyst) legitimately repeats across
-- several slots for one character, and a dual-slot item sits in both
-- sibling slots (Finger 1 and 2, Trinket 1 and 2). Slot and track are
-- compared with "is not distinct from" because rows predating #386 carry no
-- slot and the form sends '' for a row that never had one. A rejected row
-- does not block (rejection means "not this one, try again if things
-- change") and a deleted row is gone, so the cleanup Delete from #756 is
-- also the way to a second row when an officer truly wants one. Source and
-- note are not in the key: a resubmit that changes the note is still the
-- same report, and the officer reads the pending row's note.
--
-- The character lookup takes the row for update, the lock
-- delete_self_received_request() and add_signup_to_roster() already use, so
-- two submissions for one character serialise: the second waits on the row,
-- then its check runs on a fresh snapshot and sees the first's committed
-- insert. A partial unique index would say the same thing, but prod still
-- carries duplicate pairs the index would refuse to build over, and
-- deleting them belongs to the audit-logged Delete, not a migration.
--
-- direct_mark_received() carries the same guard: an officer misclick makes
-- the same pair. Its sentences point the officer at the pending report
-- instead of a second row. Both functions keep their grants; create or
-- replace preserves them, and tests/rls/function-invariants.test.js pins
-- the anon allowlist.
create or replace function public.submit_self_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null::text,
  p_source text default null::text,
  p_note text default null::text,
  p_slot text default null::text
)
returns table(id integer, auto_approved boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(p_source, '') = 'Other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say where the item came from in the note. An officer reviews Other reports.';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  select r.status into v_existing_status
  from public.self_received_requests r
  where r.player_id = v_player_id
    and r.self_item_id = v_item_id
    and r.slot is not distinct from nullif(p_slot, '')
    and r.track is not distinct from p_track
    and r.status in ('pending', 'approved')
  order by r.status
  limit 1;
  if v_existing_status = 'approved' then
    raise exception 'You already reported this item, and it is already approved.';
  elsif v_existing_status = 'pending' then
    raise exception 'You already reported this item. It is waiting for an officer to review it.';
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.person_id = public.my_person_id();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;

create or replace function public.direct_mark_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null::text,
  p_source text default null::text,
  p_note text default null::text,
  p_slot text default null::text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_existing_status text;
  v_request_id integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null
  for update;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  select r.status into v_existing_status
  from public.self_received_requests r
  where r.player_id = v_player_id
    and r.self_item_id = v_item_id
    and r.slot is not distinct from nullif(p_slot, '')
    and r.track is not distinct from p_track
    and r.status in ('pending', 'approved')
  order by r.status
  limit 1;
  if v_existing_status = 'approved' then
    raise exception 'This item is already marked received for this character.';
  elsif v_existing_status = 'pending' then
    raise exception 'A report for this item is already waiting for review. Approve or reject that one instead of marking it again.';
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $$;
