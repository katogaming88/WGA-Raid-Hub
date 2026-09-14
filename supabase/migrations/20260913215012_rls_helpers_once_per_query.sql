-- #1106: access rules look up the caller's roles once per query, not once per row.
--
-- Most rules called a helper with a per-row argument, such as
-- my_team_role(team_id) or is_own_player(player_id), each running its own
-- query against team_members/players. Postgres cannot cache a call whose
-- argument changes row to row, so reading 1,715 wishlist rows ran that lookup
-- 1,715 times. Measured 2026-09-13 on the previous night's production backup,
-- signed in as an officer (full table on #1106):
--
--   item_preferences   127 ms -> 5.0 ms     audit_log             45 ms -> 2.3 ms
--   bis_demand_vs_awards 42 ms -> 1.9 ms   self_received_requests 9.6 ms -> 1.4 ms
--
-- #1106 proposed putting roles in the login token. This gets the same speed
-- (the rewritten reads run as fast as with the rules skipped) without a token
-- hook, and roles still come from the tables live, so removing someone's
-- access applies on their next request rather than when their token refreshes.
--
-- The shape: three helpers return the caller's ids as an array, and a rule
-- compares against the array wrapped in a scalar subquery,
--
--   team_id = ANY ((SELECT my_officer_team_ids())::integer[])
--
-- The subquery has no reference to the row, so the planner runs it once per
-- statement (an InitPlan). The argument-free helpers (is_site_admin(),
-- is_guild_officer(), is_boe_manager(), is_any_team_officer(),
-- current_discord_id(), auth.uid()) are wrapped as (SELECT ...) for the same
-- reason. The cast keeps ANY reading an array rather than a set of rows.
--
-- Each rule grants exactly what it did before:
--   my_team_role(team_id) = ANY (officer, team_leader)  ->  team_id in my_officer_team_ids()
--   my_team_role(team_id) = 'team_leader'               ->  team_id in my_leader_team_ids()
--   is_own_player(x)                                    ->  x in my_active_player_ids()
-- A null team_id or player_id matches nothing either way, and an empty array
-- matches nothing, as a null role did. my_team_role() took an arbitrary row
-- if an account had two memberships on one team; nothing enforces one, but
-- production has none, and the array form counts any officer row.
--
-- The alter statements below were generated from pg_policies by textual
-- substitution of exactly those patterns, and nothing else in any rule
-- changed. Roles, commands and names are untouched (alter only replaces the
-- expressions). my_team_role(), is_own_player() and the rest stay: functions
-- still call them.

create or replace function public.my_officer_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where auth_user_id = auth.uid()
     and role = any (array['officer', 'team_leader']);
$$;

comment on function public.my_officer_team_ids() is
  'Teams the caller is an officer or team leader on. For access rules: team_id = ANY ((SELECT my_officer_team_ids())::integer[]) runs once per query (#1106).';

create or replace function public.my_leader_team_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(distinct team_id), '{}')
    from team_members
   where auth_user_id = auth.uid()
     and role = 'team_leader';
$$;

comment on function public.my_leader_team_ids() is
  'Teams the caller is team leader on. Once-per-query form of my_team_role(team_id) = ''team_leader'' (#1106).';

-- Same meaning as is_own_player(): characters linked to the caller that are
-- not archived (#941).
create or replace function public.my_active_player_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(p.id), '{}')
    from players p
    join team_members tm on tm.id = p.team_member_id
   where tm.auth_user_id = auth.uid()
     and p.archived_at is null;
$$;

comment on function public.my_active_player_ids() is
  'The caller''s own active characters. Once-per-query form of is_own_player() for access rules (#1106).';

-- Signed-out reads evaluate the rules too, so anon needs to call these, the
-- same as is_site_admin(). With no auth.uid() each returns an empty array.
revoke all on function public.my_officer_team_ids(), public.my_leader_team_ids(), public.my_active_player_ids() from public;
grant execute on function public.my_officer_team_ids(), public.my_leader_team_ids(), public.my_active_player_ids() to anon, authenticated;

-- account_preferences
alter policy "Accounts manage own account_preferences" on public.account_preferences
  using ((auth_user_id = (SELECT auth.uid())))
  with check ((auth_user_id = (SELECT auth.uid())));

-- attendance
alter policy "Officers write attendance" on public.attendance
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

-- audit_log
alter policy "Officers read audit_log" on public.audit_log
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin()) OR (SELECT is_guild_officer())));

-- bis_items
alter policy "Officers write bis_items" on public.bis_items
  using (((((SELECT players.team_id FROM players WHERE (players.id = bis_items.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check (((((SELECT players.team_id FROM players WHERE (players.id = bis_items.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Raiders update own bis_items obtained" on public.bis_items
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])))
  with check ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- bis_requests
alter policy "Officers read bis_requests" on public.bis_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Officers update bis_requests" on public.bis_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- boe_items
alter policy "BoE managers delete boe_items" on public.boe_items
  using (((SELECT is_boe_manager()) OR (SELECT is_site_admin())));
alter policy "BoE managers update boe_items" on public.boe_items
  using (((SELECT is_boe_manager()) OR (SELECT is_site_admin())))
  with check (((SELECT is_boe_manager()) OR (SELECT is_site_admin())));
alter policy "Officers read boe_items" on public.boe_items
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_boe_manager()) OR (SELECT is_site_admin())));
alter policy "Raiders read own boe_items" on public.boe_items
  using (((player_id = ANY ((SELECT my_active_player_ids())::integer[])) OR ((finder_discord_id IS NOT NULL) AND (finder_discord_id = (SELECT current_discord_id())))));

-- boe_listings
alter policy "BoE managers delete boe_listings" on public.boe_listings
  using (((SELECT is_boe_manager()) OR (SELECT is_site_admin())));
alter policy "Officers read boe_listings" on public.boe_listings
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_boe_manager()) OR (SELECT is_site_admin())));
alter policy "Raiders read own boe_listings" on public.boe_listings
  using ((EXISTS ( SELECT 1
   FROM boe_items b
  WHERE ((b.id = boe_listings.boe_item_id) AND ((b.player_id = ANY ((SELECT my_active_player_ids())::integer[])) OR ((b.finder_discord_id IS NOT NULL) AND (b.finder_discord_id = (SELECT current_discord_id()))))))));

-- boe_managers
alter policy "Officers read boe_managers" on public.boe_managers
  using (((SELECT is_any_team_officer()) OR (SELECT is_site_admin())));
alter policy "Site Admins write boe_managers" on public.boe_managers
  using ((SELECT is_site_admin()))
  with check ((SELECT is_site_admin()));

-- guild_officers
alter policy "Site Admins read guild_officers" on public.guild_officers
  using ((SELECT is_site_admin()));
alter policy "Site Admins write guild_officers" on public.guild_officers
  using ((SELECT is_site_admin()))
  with check ((SELECT is_site_admin()));

-- item_preferences
alter policy "Officers clear item_preferences note" on public.item_preferences
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Officers read item_preferences" on public.item_preferences
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin()) OR (SELECT is_guild_officer())));
alter policy "Raiders manage own item_preferences" on public.item_preferences
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])))
  with check ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- mplus_exclusion_requests
alter policy "Officers read mplus_exclusion_requests" on public.mplus_exclusion_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Officers update mplus_exclusion_requests" on public.mplus_exclusion_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- notifications
alter policy "Raiders mark own notifications read" on public.notifications
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])))
  with check ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));
alter policy "Raiders read own notifications" on public.notifications
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- player_equipped_gear
alter policy "Officers write player_equipped_gear" on public.player_equipped_gear
  using (((((SELECT players.team_id FROM players WHERE (players.id = player_equipped_gear.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check (((((SELECT players.team_id FROM players WHERE (players.id = player_equipped_gear.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- player_officer_notes
alter policy "Officers write player_officer_notes" on public.player_officer_notes
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

-- player_wcl_season_perf
alter policy "Officers write player_wcl_season_perf" on public.player_wcl_season_perf
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- players
alter policy "Officers write players" on public.players
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
alter policy "Raiders update own bonus_roll_encounter_id" on public.players
  using ((id = ANY ((SELECT my_active_player_ids())::integer[])))
  with check ((id = ANY ((SELECT my_active_player_ids())::integer[])));

-- priority_conflict_dismissals
alter policy "Officers manage priority_conflict_dismissals" on public.priority_conflict_dismissals
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- priority_order
alter policy "Officers write priority_order" on public.priority_order
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- priority_order_confirmed_empty
alter policy "Officers write priority_order_confirmed_empty" on public.priority_order_confirmed_empty
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- priority_stale_dismissals
alter policy "Officers manage priority_stale_dismissals" on public.priority_stale_dismissals
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- raid_rsvps
alter policy "Officers read raid_rsvps" on public.raid_rsvps
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));
alter policy "Own raid_rsvps read" on public.raid_rsvps
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- raid_schedule
alter policy "Officers write raid_schedule" on public.raid_schedule
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

-- raid_schedule_exceptions
alter policy "Officers write raid_schedule_exceptions" on public.raid_schedule_exceptions
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

-- rclc_loot
alter policy "Officer write loot" on public.rclc_loot
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- scoring
alter policy "Officers write scoring" on public.scoring
  using (((((SELECT players.team_id FROM players WHERE (players.id = scoring.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check (((((SELECT players.team_id FROM players WHERE (players.id = scoring.player_id)) = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- season_signups
alter policy "Officers read signups" on public.season_signups
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Officers update signups" on public.season_signups
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- self_received_requests
alter policy "Officers read self_received_requests" on public.self_received_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Officers update self_received_requests" on public.self_received_requests
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Raiders read own self_received_requests" on public.self_received_requests
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- site_admins
alter policy "Site Admins read site_admins" on public.site_admins
  using ((SELECT is_site_admin()));
alter policy "Site Admins write site_admins" on public.site_admins
  using ((SELECT is_site_admin()))
  with check ((SELECT is_site_admin()));

-- streamers
alter policy "Officers write streamers" on public.streamers
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));
alter policy "Raiders manage own streamer" on public.streamers
  using ((player_id = ANY ((SELECT my_active_player_ids())::integer[])))
  with check ((player_id = ANY ((SELECT my_active_player_ids())::integer[])));

-- team_members
alter policy "Members read own team_members" on public.team_members
  using ((auth_user_id = (SELECT auth.uid())));
alter policy "Officers read own team_members" on public.team_members
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin()) OR (SELECT is_guild_officer())));
alter policy "Team leaders write team_members" on public.team_members
  using ((((team_id = ANY ((SELECT my_leader_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_leader_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- team_raid_progress
alter policy "Officers write team_raid_progress" on public.team_raid_progress
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_site_admin())));

-- team_settings
alter policy "Team leaders write settings" on public.team_settings
  using ((((team_id = ANY ((SELECT my_leader_team_ids())::integer[]))) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_leader_team_ids())::integer[]))) OR (SELECT is_site_admin())));
