-- Bridge approved self-received loot to bis_items.obtained (#386).
--
-- #217 gave officers a manual "Obtained" checkbox on bis_items, and #406 moved
-- the self-received flow onto Supabase, but nothing linked the two: a raider
-- marking an item received (or an officer direct-marking it) left the matching
-- BiS row unticked, so an officer had to repeat the action in BiS Manager. Per
-- #217's intent, BiS Manager stays the one place officers actively *edit* a
-- list; "Mark received" is a received-state signal that now keeps `obtained` in
-- sync on its own.
--
-- The slot has to come along for the ride. bis_items is unique on
-- (player_id, item_id, coalesce(slot, '')) because the placeholder items --
-- 'M+', 'Crafted', 'Catalyst' (items.is_placeholder) -- name a loot *source*
-- rather than a piece of gear, so one player legitimately lists 'M+' against
-- six different slots. self_received_requests only stored self_item_id, so an
-- approved 'M+' could not say which of those six rows it filled. The frontend
-- already knows which one (the "Mark received" button is rendered per BiS row
-- and passes that row's slot); it just had nowhere to put it. Store it, and
-- target the exact row.

alter table public.self_received_requests
  add column if not exists slot text;

comment on column public.self_received_requests.slot is
  'BiS slot the request was raised against, mirroring bis_items.slot. Lets an approval target one row when the same item -- notably an is_placeholder source like M+ -- sits in several slots. Null on rows predating #386.';

-- Both writers gain p_slot. These are dropped and recreated rather than
-- CREATE OR REPLACEd: a function is identified by (name, argument types), so
-- adding a parameter would leave the old 6-argument version in place as an
-- overload and PostgREST could still resolve calls to it.
drop function if exists public.submit_self_received(integer, text, text, text, text, text);
drop function if exists public.direct_mark_received(integer, text, text, text, text, text);

-- Unchanged from #406 except for p_slot: auto-approve still resolves "is the
-- submitting raider signed in as this character" through
-- players.team_member_id -> team_members.auth_user_id.
create or replace function public.submit_self_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_source text default null,
  p_note text default null,
  p_slot text default null
) returns table(id integer, auto_approved boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  if auth.uid() is not null then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.auth_user_id = auth.uid();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;

revoke all on function public.submit_self_received(integer, text, text, text, text, text, text) from public;
grant execute on function public.submit_self_received(integer, text, text, text, text, text, text) to anon, authenticated;

-- Officer direct-mark: bypasses the approval queue and inserts pre-approved.
create or replace function public.direct_mark_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_source text default null,
  p_note text default null,
  p_slot text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_request_id integer;
begin
  if not (public.my_team_role(p_team_id) = any(array['officer', 'team_leader']) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.direct_mark_received(integer, text, text, text, text, text, text) from public;
grant execute on function public.direct_mark_received(integer, text, text, text, text, text, text) to authenticated;

-- The flip itself lives in a trigger rather than in the two writers above,
-- because there is a third way a request reaches 'approved': the officer
-- Requests tab (js/tabs/tab-requests.js) approves a pending row with a plain
-- UPDATE, not an RPC. A trigger catches all three paths -- raider auto-approve,
-- officer direct-mark, officer approving from the queue -- and cannot be
-- bypassed by a future fourth one.
--
-- SECURITY DEFINER because a raider auto-approving their own item is not an
-- officer, and writes to bis_items are restricted to officers.
--
-- One-way on purpose: approving sets obtained = true, but rejecting or
-- reverting an approval never sets it back to false. An officer may have ticked
-- the box by hand in BiS Manager for an unrelated reason, and clearing it here
-- would silently discard that. Untick is a deliberate officer action.
create or replace function public.sync_bis_obtained_from_self_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.player_id is null then
    return new;
  end if;

  update public.bis_items b
     set obtained = true,
         updated_at = now()
   where b.player_id = new.player_id
     and b.item_id = new.self_item_id
     and b.obtained = false
     and (
       -- Slot recorded: fill exactly that row.
       (new.slot is not null and coalesce(b.slot, '') = new.slot)
       -- No slot (a row predating this migration): only safe to infer the
       -- target when the item occupies exactly one slot for this player.
       -- Otherwise leave it for an officer rather than guess.
       or (
         new.slot is null
         and (
           select count(*)
           from public.bis_items b2
           where b2.player_id = new.player_id
             and b2.item_id = new.self_item_id
         ) = 1
       )
     );

  return new;
end $$;

-- Fires on insert (both RPCs can land straight in 'approved') and on a status
-- change (the Requests tab moving pending -> approved). Re-approving an already
-- approved row is a no-op: the update above only touches rows still unobtained.
drop trigger if exists trg_self_received_sync_bis_obtained on public.self_received_requests;
create trigger trg_self_received_sync_bis_obtained
after insert or update of status on public.self_received_requests
for each row
when (new.status = 'approved')
execute function public.sync_bis_obtained_from_self_received();
