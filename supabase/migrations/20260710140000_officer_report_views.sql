-- Officer report views (#227, Phase 5).
--
-- Read-only reports for officers, built on top of the now-fully-migrated
-- loot/attendance/BiS/priority tables (#216-#220). All views use
-- security_invoker so the caller's own row-security rule set applies. Every
-- table these views read from already lets anyone read every row (see each
-- table's own "Public read" rule, `using (true)`), so the views are no more
-- exposed than querying the base tables directly -- no separate grant/revoke
-- needed here, the default anon/authenticated grants from #284
-- (20260706190427) already apply to new views the same as tables.
--
-- None of these views take a season/team parameter (views can't be
-- parameterized); each returns team_id/season as output columns so officers
-- filter with a WHERE clause when querying by name, per the issue's own
-- "so officers can query by name without rewriting SQL" framing.

-- Raid nights since last item (RNLSI), replaces the old WSLI spreadsheet
-- column. "Raid night" = a distinct attendance.raid_date for the team, per
-- the issue text ("not calendar days") -- it does not require the player
-- personally attended that night, only that the team raided.
create view public.rnlsi
with (security_invoker = on)
as
select
  p.id as player_id,
  p.team_id,
  p.name_realm,
  cs.role,
  la.last_award_at,
  (
    select count(distinct a.raid_date)
    from public.attendance a
    where a.team_id = p.team_id
      and (la.last_award_at is null or a.raid_date > la.last_award_at::date)
  ) as raid_nights_since_last_item
from public.players p
left join public.classes_specs cs on cs.id = p.class_spec_id
left join lateral (
  select max(rl.awarded_at) as last_award_at
  from public.rclc_loot rl
  where rl.player_id = p.id
) la on true
where p.archived_at is null
order by p.team_id, cs.role, raid_nights_since_last_item desc;

-- BiS demand vs awards: how many players want an item (active roster only)
-- vs. how many times it's actually been awarded, per season. High demand +
-- low awarded_count is what officers are looking for.
create view public.bis_demand_vs_awards
with (security_invoker = on)
as
with demand as (
  select p.team_id, bi.item_id, count(distinct bi.player_id) as demand_count
  from public.bis_items bi
  join public.players p on p.id = bi.player_id
  where p.archived_at is null
  group by p.team_id, bi.item_id
),
awards as (
  select team_id, item_id, season, count(*) as awarded_count
  from public.rclc_loot
  where item_id is not null
  group by team_id, item_id, season
)
select
  d.team_id,
  d.item_id,
  i.name as item_name,
  i.slot,
  d.demand_count,
  a.season,
  coalesce(a.awarded_count, 0) as awarded_count
from demand d
join public.items i on i.id = d.item_id
left join awards a on a.team_id = d.team_id and a.item_id = d.item_id
order by d.team_id, d.demand_count desc, coalesce(a.awarded_count, 0) asc;

-- Priority order health, check 1: priority_order rows for players no longer
-- on the active roster (archived). Stale entries to clean up.
create view public.priority_order_stale_entries
with (security_invoker = on)
as
select
  po.id as priority_order_id,
  po.team_id,
  po.season,
  po.item_id,
  i.name as item_name,
  po.track,
  po.rank,
  po.player_id,
  p.name_realm,
  p.archived_at
from public.priority_order po
join public.players p on p.id = po.player_id
join public.items i on i.id = po.item_id
where p.archived_at is not null
order by po.team_id, po.season, i.name, po.track, po.rank;

-- Priority order health, check 2: active, non-bench players who don't
-- appear anywhere in priority_order for a season the team has started
-- building lists for. Gaps to fill.
create view public.priority_order_gaps
with (security_invoker = on)
as
select distinct
  s.team_id,
  s.season,
  p.id as player_id,
  p.name_realm
from (select distinct team_id, season from public.priority_order) s
join public.players p on p.team_id = s.team_id
where p.archived_at is null
  and not p.is_bench
  and not exists (
    select 1
    from public.priority_order po
    where po.team_id = s.team_id
      and po.season = s.season
      and po.player_id = p.id
  )
order by s.team_id, s.season, p.name_realm;

-- Season over season loot pace: items awarded per "week of season",
-- broken down by track (difficulty) and slot.
--
-- Caveat: there is no season-start-date column anywhere yet (that's #221's
-- scope, Phase 6, not landed). This view proxies season start with the
-- earliest rclc_loot.awarded_at for that team+season, so "week 1" means
-- "the week of the first tracked loot award," not the actual raid-lockout
-- start date. Revisit once #221 lands a real season start date.
create view public.season_loot_pace
with (security_invoker = on)
as
with season_bounds as (
  select team_id, season, min(awarded_at) as season_start
  from public.rclc_loot
  group by team_id, season
)
select
  rl.team_id,
  rl.season,
  (floor(extract(epoch from (rl.awarded_at - sb.season_start)) / (7 * 86400))::int + 1) as season_week,
  rl.track,
  i.slot,
  count(*) as items_awarded
from public.rclc_loot rl
join season_bounds sb on sb.team_id = rl.team_id and sb.season = rl.season
left join public.items i on i.id = rl.item_id
group by rl.team_id, rl.season, season_week, rl.track, i.slot
order by rl.team_id, rl.season, season_week;
