-- Priority order fairness warnings.
--
-- Three read-only views surfacing situations the priority generator and
-- saved priority_order lists don't otherwise flag: a player already sitting
-- #1 on more than one item before everyone on the roster has a first #1, a
-- player #1 on two items tied to the same boss, and a saved Mythic #1 whose
-- player has since been awarded the Heroic version of that exact item.
-- None of these block a save -- they're warnings only, matching how
-- generate_priority_order()'s own has_hero/has_myth checks already work as
-- soft signals rather than hard removals.
--
-- All security_invoker, same reasoning as
-- 20260710140000_officer_report_views.sql: every table read here already
-- lets anyone read every row (see each table's own "Public read" rule,
-- `using (true)`), so these views expose nothing a direct table query
-- wouldn't.

-- A "live" #1: rank = 1 in priority_order, not yet satisfied by an actual
-- award for that exact item+track+player in rclc_loot. The shared base for
-- the two fairness views below.
create view public.priority_order_live_first_prios
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
  );

-- Fairness check 1: how many distinct items is each player currently #1
-- for, team-wide. Deduped by item_id (not track) -- a Hero #1 and a Myth #1
-- on the *same* item only count once, since in practice only one track will
-- actually drop for a given kill; only a #1 on a genuinely different item
-- represents a second turn in line.
create view public.priority_order_first_prio_counts
with (security_invoker = on)
as
select
  team_id,
  season,
  player_id,
  name_realm,
  count(distinct item_id) as first_prio_count
from public.priority_order_live_first_prios
group by team_id, season, player_id, name_realm
order by team_id, season, first_prio_count desc;

-- Fairness check 2: a player holding #1 on more than one item tied to the
-- same boss (within the same track -- Hero and Myth lists are treated as
-- separate turns, see check 3 for the cross-track case). item_bosses is
-- many-to-many so a boss shared between items would surface here too --
-- that is still a legitimate same-boss conflict.
create view public.priority_order_same_boss_conflicts
with (security_invoker = on)
as
select
  a.team_id,
  a.season,
  a.track,
  a.boss,
  a.player_id,
  a.name_realm,
  a.item_id,
  a.item_name,
  b.item_id as other_item_id,
  b.item_name as other_item_name
from public.priority_order_live_first_prios a
join public.priority_order_live_first_prios b
  on a.team_id = b.team_id
  and a.season = b.season
  and a.track = b.track
  and a.boss = b.boss
  and a.player_id = b.player_id
  and a.item_id < b.item_id
where a.boss is not null;

-- Fairness check 3: a saved Mythic #1 whose player has already received the
-- Heroic version of that exact item -- may still be intentional (they can
-- still want the upgrade), but worth an officer's second look rather than
-- sitting unreviewed.
create view public.priority_order_stale_after_heroic
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
  and exists (
    select 1
    from public.rclc_loot rl
    where rl.team_id = po.team_id
      and rl.season = po.season
      and rl.item_id = po.item_id
      and rl.track = 'Hero'
      and rl.player_id = po.player_id
  )
order by po.team_id, po.season, i.name;
