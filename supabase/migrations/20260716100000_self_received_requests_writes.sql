-- Self-received loot request write path (#406).
--
-- self_received_requests fit the live feature exactly (track/source/note
-- match submitSelfReceivedRequest's payload one-to-one) -- it just never had
-- an INSERT path or any frontend reference. Two RPCs, mirroring the
-- request-table pattern from #404/#405, both SECURITY DEFINER: request
-- tables intentionally allow no direct INSERT for anyone, officers included
-- (tests/rls/write-policies.test.js "request tables have no INSERT path"),
-- so even the officer direct-mark path has to go through a definer function
-- rather than a plain insert gated by RLS.
--
-- submit_self_received's auto-approve replaces GAS's legacy Discord OAuth
-- session-token check with the real thing: #222 already swapped login itself
-- to Supabase Auth, so "is the submitting raider signed in as this
-- character" is now a straight auth.uid() lookup through
-- players.team_member_id -> team_members.auth_user_id, instead of trusting a
-- client-supplied session token.
create or replace function public.submit_self_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_source text default null,
  p_note text default null
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
    (team_id, player_id, self_item_id, track, source, note, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;

revoke all on function public.submit_self_received(integer, text, text, text, text, text) from public;
grant execute on function public.submit_self_received(integer, text, text, text, text, text) to anon, authenticated;

-- Officer direct-mark: bypasses the approval queue entirely and inserts
-- pre-approved, same as GAS's directMarkReceived. Role check happens inside
-- the function body since there's no INSERT grant to lean on.
create or replace function public.direct_mark_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_source text default null,
  p_note text default null
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
    (team_id, player_id, self_item_id, track, source, note, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''), 'approved')
  returning self_received_requests.id into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.direct_mark_received(integer, text, text, text, text, text) from public;
grant execute on function public.direct_mark_received(integer, text, text, text, text, text) to authenticated;
