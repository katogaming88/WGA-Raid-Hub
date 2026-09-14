-- View public.priority_order_first_prio_counts: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.priority_order_first_prio_counts with (security_invoker=on) as
 SELECT team_id,
    season,
    player_id,
    name_realm,
    count(DISTINCT item_id) AS first_prio_count
   FROM priority_order_live_first_prios
  GROUP BY team_id, season, player_id, name_realm
  ORDER BY team_id, season, (count(DISTINCT item_id)) DESC;
