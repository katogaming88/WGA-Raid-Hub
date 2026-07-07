-- Rename the difficulty columns to track and store the real track names
-- (Champion/Hero/Myth), per the decision on #343. The columns always meant
-- the item's upgrade track: the GAS app translates Normal-difficulty drops
-- to "champion", and self_received_requests reuses the same values for
-- M+ vault, crafted, and catalyst items that never dropped at any raid
-- difficulty. Heroic/Mythic were convenience labels kept because they lined
-- up with the instance difficulty (#320 B2); the track names replace them.

-- rclc_loot: difficulty -> track, Champion/Hero/Myth
alter table public.rclc_loot drop constraint loot_difficulty_check;
update public.rclc_loot set difficulty = 'Hero' where difficulty = 'Heroic';
update public.rclc_loot set difficulty = 'Myth' where difficulty = 'Mythic';
alter table public.rclc_loot rename column difficulty to track;
alter table public.rclc_loot add constraint rclc_loot_track_check
  check (track in ('Champion', 'Hero', 'Myth'));

-- self_received_requests: difficulty -> track, Champion/Hero/Myth
-- (empty in prod today; the updates are for any other environment)
alter table public.self_received_requests drop constraint self_received_requests_difficulty_check;
update public.self_received_requests set difficulty = 'Hero' where difficulty = 'Heroic';
update public.self_received_requests set difficulty = 'Myth' where difficulty = 'Mythic';
alter table public.self_received_requests rename column difficulty to track;
alter table public.self_received_requests add constraint self_received_requests_track_check
  check (track in ('Champion', 'Hero', 'Myth'));

-- priority_order: difficulty -> track, Hero/Myth only. Champion loot never
-- enters the priority system: it is first-weeks loot council handled via
-- RCLC's roll column (#343).
alter table public.priority_order drop constraint priority_order_difficulty_check;
update public.priority_order set difficulty = 'Hero' where difficulty = 'Heroic';
update public.priority_order set difficulty = 'Myth' where difficulty = 'Mythic';
alter table public.priority_order rename column difficulty to track;
alter table public.priority_order add constraint priority_order_track_check
  check (track in ('Hero', 'Myth'));

-- The rank unique constraint's auto-generated name still said difficulty.
alter table public.priority_order rename constraint priority_order_team_id_season_item_difficulty_rank_key
  to priority_order_team_id_season_item_track_rank_key;
