-- BiS link submission write path (#404).
--
-- bis_requests existed since initial_schema.sql (Officers read/update RLS
-- already in place) but nothing ever wrote to it -- confirmed 0 rows in
-- production. Its actual shape (bis_req_item_id integer NOT NULL, an FK to
-- items) can't hold what the live raider-facing feature actually submits: a
-- whole BiS list URL (js/common.js submitBiSForm -> GAS submitBiS), one per
-- player, unrelated to any single item. The table was scaffolded alongside
-- the other request tables (self_received_requests, mplus_exclusion_requests)
-- assuming a per-item shape that this feature never matched. Repurposing it
-- rather than adding a second table, since it is empty and unreferenced
-- anywhere: drop the item FK, add the columns the real feature needs.
alter table public.bis_requests
  drop column bis_req_item_id,
  add column bis_link text not null,
  add column player_note text;

-- Per-player submission gate (#404's "allowBisForPlayer/revokeBisForPlayer
-- permission gating" TBD). GAS stored this as a Script Property array of
-- name-realms (bisAllowedPlayers) toggled by any officer, no role
-- distinction. The natural Supabase home for team-wide config,
-- set_team_setting() (#221), is gated by "Team leaders write settings" --
-- routing a per-player toggle through it would tighten today's any-officer
-- access down to team_leader/site_admin only. A boolean column on players
-- keeps this on the existing officer-write RLS rule for that table instead
-- (already officer *and* team_leader), so the toggle stays exactly as
-- accessible as it is today, using the same direct-write pattern
-- js/tabs/tab-roster.js already uses elsewhere -- no new RPC needed.
alter table public.players
  add column bis_allowed boolean not null default false;

-- SECURITY DEFINER, granted to anon: submitBiSForm runs unauthenticated on
-- the public roster page (same trust model as the old GAS action, which had
-- no server-side check at all beyond the client only showing the form when
-- allowed). This function re-validates the gate server-side rather than
-- trusting the client's decision to show the form.
create or replace function public.submit_bis_link(
  p_team_id integer,
  p_name_realm text,
  p_bis_link text,
  p_player_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_player_id integer;
  v_bis_allowed boolean;
  v_request_id integer;
begin
  if coalesce(trim(p_bis_link), '') = '' then
    raise exception 'BiS link cannot be blank';
  end if;

  select id, bis_allowed into v_player_id, v_bis_allowed
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select config into v_config from public.team_settings where team_id = p_team_id;
  if not (coalesce((v_config->>'bisSubmissionsOpen')::boolean, false) or coalesce(v_bis_allowed, false)) then
    raise exception 'BiS submissions are not open for this character';
  end if;

  insert into public.bis_requests (team_id, player_id, bis_link, player_note, status)
  values (p_team_id, v_player_id, trim(p_bis_link), nullif(p_player_note, ''), 'pending')
  returning id into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.submit_bis_link(integer, text, text, text) from public;
grant execute on function public.submit_bis_link(integer, text, text, text) to anon, authenticated;
