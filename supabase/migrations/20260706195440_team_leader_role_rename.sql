-- Implements the naming decision from #294: the per-team role stored as
-- 'admin' becomes 'team_leader', so it can never be confused with the
-- site_admins tier. Same access, new name. Covers the stored values, the
-- CHECK constraint, and every policy that referenced the old literal;
-- the three "Admins write ..." policies are also renamed to
-- "Team leaders write ...".

-- Role values and their CHECK constraint.
alter table public.team_members drop constraint team_members_role_check;
update public.team_members set role = 'team_leader' where role = 'admin';
alter table public.team_members add constraint team_members_role_check
  check (role = any (array['raider'::text, 'officer'::text, 'team_leader'::text]));

-- Officer-tier policies: 'admin' -> 'team_leader' in the role arrays.
alter policy "Officers write attendance" on public.attendance
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read audit_log" on public.audit_log
  using ((my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text])) or is_site_admin());

alter policy "Officers write bis_items" on public.bis_items
  using (my_team_role((select players.team_id from players where players.id = bis_items.player_id)) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role((select players.team_id from players where players.id = bis_items.player_id)) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read bis_requests" on public.bis_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers update bis_requests" on public.bis_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers update mplus_exclusion_requests" on public.mplus_exclusion_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers write player_wcl_season_perf" on public.player_wcl_season_perf
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers write players" on public.players
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers write priority_order" on public.priority_order
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officer write loot" on public.rclc_loot
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers write scoring" on public.scoring
  using (my_team_role((select players.team_id from players where players.id = scoring.player_id)) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role((select players.team_id from players where players.id = scoring.player_id)) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read signups" on public.season_signups
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers update signups" on public.season_signups
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read self_received_requests" on public.self_received_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers update self_received_requests" on public.self_received_requests
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]))
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]));

alter policy "Officers read own team_members" on public.team_members
  using ((my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text])) or is_site_admin());

-- Team-leader-tier policies: rename plus the same literal swap.
alter policy "Admins write season_snapshots" on public.season_snapshots rename to "Team leaders write season_snapshots";
alter policy "Team leaders write season_snapshots" on public.season_snapshots
  using ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin())
  with check ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin());

alter policy "Admins write team_members" on public.team_members rename to "Team leaders write team_members";
alter policy "Team leaders write team_members" on public.team_members
  using ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin())
  with check ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin());

alter policy "Admins write settings" on public.team_settings rename to "Team leaders write settings";
alter policy "Team leaders write settings" on public.team_settings
  using ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin())
  with check ((my_team_role(team_id) = 'team_leader'::text) or is_site_admin());
