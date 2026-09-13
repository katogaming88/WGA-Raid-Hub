-- priority_order_live_first_prios times out for a signed-in officer, which
-- silently killed Priority Edit's per-row fairness flag (the blue warning
-- triangle on the #1 row reading "Holds N other #1 priorities", #838/#844)
-- and the "#1 Priorities Held" summary on the Priority List sub-tab.
--
-- Confirmed live from the browser:
--   code 57014, "canceling statement due to statement timeout"
-- and the frontend swallows a failed read (`if (result.error) return;`), so
-- the flag just stopped appearing with nothing logged anywhere.
--
-- The view filters rank-1 rows through two NOT EXISTS probes -- one against
-- rclc_loot, one against self_received_requests -- and neither table carries
-- an index matching those predicates. No migration ever created one; this is
-- not a regression, the index has simply never existed. EXPLAIN on the real
-- data shows the cost:
--
--   Seq Scan on self_received_requests  (rows=114, loops=161)
--
-- The scan re-runs per outer row: ~18k row visits for a query returning 156.
-- Read as claude_readers that is free, because that role's read rules are
-- constant `true`, and the whole view returns in 12ms. Read as authenticated
-- every one of those visits instead evaluates the officer/raider read rules,
-- each a SECURITY DEFINER function running its own query -- roughly 40k
-- function calls, which is what blows the statement timeout. That asymmetry
-- is why it looks fine from psql and fails in the app.
--
-- It also explains why this worked for months and then stopped with no code
-- change: cost scales with the size of the probed tables, and
-- self_received_requests went 3 rows (July) -> 85 (August) -> 152
-- (September). Same query, ~40x the work.
--
-- These indexes turn each probe into a lookup, so the read rules are
-- evaluated against a handful of rows instead of all of them. They also
-- cover public.priority_order_stale_after_heroic, which probes the same two
-- tables (once, not per row -- 2ms, never acute), and the two views built on
-- top of the first-prios one (priority_order_first_prio_counts,
-- priority_order_same_boss_conflicts), which inherited the timeout wholesale.
--
-- Column order follows each view's own predicate, most selective first, so
-- the probe is a single index lookup rather than a range scan.

-- rl.team_id = po.team_id and rl.season = po.season and rl.item_id =
-- po.item_id and rl.track = po.track and rl.player_id = po.player_id
create index if not exists rclc_loot_team_season_item_track_player_idx
  on public.rclc_loot (team_id, season, item_id, track, player_id);

comment on index public.rclc_loot_team_season_item_track_player_idx is
  'Covers the "already awarded this exact item on this track" probe in priority_order_live_first_prios and priority_order_stale_after_heroic. Without it those views seq-scan rclc_loot once per candidate row.';

-- sr.status = 'approved' and sr.team_id = po.team_id and sr.self_item_id =
-- po.item_id and sr.track = po.track and sr.player_id = po.player_id.
-- Partial on the status both views actually probe: the rejected and pending
-- rows are never matched here, so they are left out of the index entirely.
create index if not exists self_received_requests_approved_team_item_track_player_idx
  on public.self_received_requests (team_id, self_item_id, track, player_id)
  where status = 'approved';

comment on index public.self_received_requests_approved_team_item_track_player_idx is
  'Covers the "already self-received this exact item on this track" probe in priority_order_live_first_prios and priority_order_stale_after_heroic. Partial on status = ''approved'', the only status those views probe. Without it the first-prios view re-scans this table once per candidate row, which timed out for signed-in officers once the table passed ~150 rows.';
