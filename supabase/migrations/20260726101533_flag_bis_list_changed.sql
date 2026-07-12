-- #278: raider self-service flag when a BiS list's *contents* changed but the
-- link on file didn't -- submit_bis_link (#404) only fires on a link change,
-- and requires bisSubmissionsOpen()/bis_allowed like a fresh submission. This
-- action is always available (no gate) since it isn't granting a new link,
-- just re-queuing the player's existing bis_link for an officer to notice and
-- go recheck the BiS Lists tab. Reuses bis_requests rather than a new table:
-- the officer queue (tab-bis.js buildBisTab) already reads pending rows from
-- there, and "same link" is just bis_requests.bis_link === players.bis_link,
-- computed client-side (no new column needed).
create or replace function public.flag_bis_list_changed(
  p_team_id integer,
  p_name_realm text,
  p_player_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_bis_link text;
  v_existing_id integer;
  v_request_id integer;
begin
  select id, bis_link into v_player_id, v_bis_link
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(trim(v_bis_link), '') = '' then
    raise exception 'No BiS link on file to flag';
  end if;

  -- Re-clicking while a flag for the same link is still pending shouldn't
  -- pile up duplicate rows in the officer queue.
  select id into v_existing_id
  from public.bis_requests
  where player_id = v_player_id and status = 'pending' and bis_link = v_bis_link;
  if found then
    return v_existing_id;
  end if;

  insert into public.bis_requests (team_id, player_id, bis_link, player_note, status)
  values (p_team_id, v_player_id, v_bis_link, nullif(trim(p_player_note), ''), 'pending')
  returning id into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.flag_bis_list_changed(integer, text, text) from public;
grant execute on function public.flag_bis_list_changed(integer, text, text) to anon, authenticated;
