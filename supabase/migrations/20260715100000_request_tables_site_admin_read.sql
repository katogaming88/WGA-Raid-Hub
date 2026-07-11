-- Site admin cross-team access for request tables (#413).
--
-- Found while checking why a site admin's own account couldn't see
-- Hellfire's signup history after #403's historical backfill (the data was
-- correct -- confirmed via direct read-only access -- the account just isn't
-- a team_members row on that specific team). Most officer-scoped tables
-- already OR in is_site_admin() so a site admin isn't limited to only the
-- teams they personally hold a team_members role on (audit_log,
-- team_members, team_settings, season_snapshots). These four "request"
-- tables never got that clause when initial_schema.sql created them --
-- scoped purely to my_team_role(team_id), with no site-admin bypass at all.
-- Adding it here brings them in line with every other officer-gated table.
alter policy "Officers read signups" on public.season_signups
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());
alter policy "Officers update signups" on public.season_signups
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());

alter policy "Officers read bis_requests" on public.bis_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());
alter policy "Officers update bis_requests" on public.bis_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());

alter policy "Officers read mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());
alter policy "Officers update mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());

alter policy "Officers read self_received_requests" on public.self_received_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());
alter policy "Officers update self_received_requests" on public.self_received_requests
  using (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer','team_leader']) or is_site_admin());
