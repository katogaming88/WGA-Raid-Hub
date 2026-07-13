-- Fold approved self-received requests into the priority order fairness
-- views (20260713150512_priority_order_fairness_warnings.sql).
--
-- Those views only checked rclc_loot for "has this player already received
-- the item" -- but an officer-approved self-received request
-- (self_received_requests, status = 'approved') is just as real a receipt
-- and never touches rclc_loot (it only bridges to bis_items.obtained, see
-- #386 / 20260725100000_self_received_bis_obtained.sql). Without this, a
-- player who self-reported and got approved for an item would still show up
-- as holding a live #1 / still trigger the same-boss conflict / never flag
-- as stale-after-heroic.
--
-- self_received_requests has no season column, unlike rclc_loot -- matched
-- here on team_id + item_id + track + player_id only, ignoring season. That
-- widens the exclusion slightly (an approved self-received row from a prior
-- season would still count), but there's no season to compare against and
-- the table isn't retained across a season reset the way rclc_loot is, so
-- this is the closest available match.
--
-- CREATE OR REPLACE is safe here: neither view's output columns change,
-- only the WHERE/EXISTS conditions, so priority_order_first_prio_counts and
-- priority_order_same_boss_conflicts (which select from
-- priority_order_live_first_prios) keep working unmodified.

create or replace view public.priority_order_live_first_prios
with (security_invoker = on)
as
select
  po.id as priority_order_id,
  po.team_id,
  po.season,
  po.item_id,
  i.name as item_name,
  po.track,
  po.player_id,
  p.name_realm,
  ib.boss
from public.priority_order po
join public.items i on i.id = po.item_id
join public.players p on p.id = po.player_id
left join public.item_bosses ib on ib.item_id = po.item_id
where po.rank = 1
  and not exists (
    select 1
    from public.rclc_loot rl
    where rl.team_id = po.team_id
      and rl.season = po.season
      and rl.item_id = po.item_id
      and rl.track = po.track
      and rl.player_id = po.player_id
  )
  and not exists (
    select 1
    from public.self_received_requests sr
    where sr.status = 'approved'
      and sr.team_id = po.team_id
      and sr.self_item_id = po.item_id
      and sr.track = po.track
      and sr.player_id = po.player_id
  );

create or replace view public.priority_order_stale_after_heroic
with (security_invoker = on)
as
select
  po.id as priority_order_id,
  po.team_id,
  po.season,
  po.item_id,
  i.name as item_name,
  po.player_id,
  p.name_realm
from public.priority_order po
join public.items i on i.id = po.item_id
join public.players p on p.id = po.player_id
where po.track = 'Myth'
  and po.rank = 1
  and (
    exists (
      select 1
      from public.rclc_loot rl
      where rl.team_id = po.team_id
        and rl.season = po.season
        and rl.item_id = po.item_id
        and rl.track = 'Hero'
        and rl.player_id = po.player_id
    )
    or exists (
      select 1
      from public.self_received_requests sr
      where sr.status = 'approved'
        and sr.team_id = po.team_id
        and sr.self_item_id = po.item_id
        and sr.track = 'Hero'
        and sr.player_id = po.player_id
    )
  )
order by po.team_id, po.season, i.name;
