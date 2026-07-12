-- Move the Danger Zone's request-table "Clear ___ Sheet" ops off GAS (#225).
--
-- These still called GAS's dangerClearSheet action, wiping the old Google
-- Sheet that nothing has read since each table's own migration (#403-#406)
-- moved the live data onto Supabase -- reporting success while doing nothing
-- real, the same failure shape #423 found and fixed for Clear Season History.
--
-- Request tables intentionally allow no DELETE for anyone, officers
-- included (tests/rls/write-policies.test.js), so each needs a SECURITY
-- DEFINER function. All five are site-admin only, matching the Danger Zone's
-- existing access model: none of these ops carry `teamLeader: true` in
-- DANGER_OPS (only Clear Season History does, per the #294 decision), so
-- unlike direct_mark_received() etc. these check is_site_admin() alone, not
-- my_team_role() OR is_site_admin().
--
-- rclc_loot ("Clear Loot Data Sheet") is not here: officers already have a
-- direct ALL grant on it for their own team, so that op needs no RPC and
-- stays a plain client-side delete.
--
-- "Clear Pasted Loot Sheet" is not here either -- there is no Supabase
-- equivalent to migrate. #219 replaced the old paste-to-sheet-then-import
-- flow with a single paste-to-RPC import (import_rclc_loot()) that writes
-- straight to rclc_loot with no staging table, so the concept this op cleared
-- no longer exists. Retired outright on the frontend, not migrated.

create or replace function public.danger_clear_bis_requests(p_team_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.bis_requests where team_id = p_team_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.danger_clear_bis_requests(integer) from public;
grant execute on function public.danger_clear_bis_requests(integer) to authenticated;

-- Clears every signup application for the team, any status. Distinct from
-- danger_clear_pending_roster below, which only clears the approved-but-not-
-- yet-pushed subset.
create or replace function public.danger_clear_season_signups(p_team_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.season_signups where team_id = p_team_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.danger_clear_season_signups(integer) from public;
grant execute on function public.danger_clear_season_signups(integer) to authenticated;

-- The old GAS "Pending Roster" sheet was the queue of approved signups not
-- yet added to the roster, not every signup ever submitted -- the pending_
-- roster view's own WHERE clause is the definition to match: status =
-- 'approved' and approved_player_id is null. Clearing rejected or already-
-- pushed signups is not this op's job; danger_clear_season_signups covers
-- wiping everything.
create or replace function public.danger_clear_pending_roster(p_team_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.season_signups
   where team_id = p_team_id
     and status = 'approved'
     and approved_player_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.danger_clear_pending_roster(integer) from public;
grant execute on function public.danger_clear_pending_roster(integer) to authenticated;

create or replace function public.danger_clear_mplus_exclusion_requests(p_team_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.mplus_exclusion_requests where team_id = p_team_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.danger_clear_mplus_exclusion_requests(integer) from public;
grant execute on function public.danger_clear_mplus_exclusion_requests(integer) to authenticated;

create or replace function public.danger_clear_self_received_requests(p_team_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.self_received_requests where team_id = p_team_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.danger_clear_self_received_requests(integer) from public;
grant execute on function public.danger_clear_self_received_requests(integer) to authenticated;
