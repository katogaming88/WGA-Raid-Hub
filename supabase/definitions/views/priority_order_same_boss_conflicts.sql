-- View public.priority_order_same_boss_conflicts: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.priority_order_same_boss_conflicts with (security_invoker=on) as
 SELECT a.team_id,
    a.season,
    a.track,
    a.boss,
    a.player_id,
    a.name_realm,
    a.item_id,
    a.item_name,
    b.item_id AS other_item_id,
    b.item_name AS other_item_name
   FROM priority_order_live_first_prios a
     JOIN priority_order_live_first_prios b ON a.team_id = b.team_id AND a.season = b.season AND a.track = b.track AND a.boss = b.boss AND a.player_id = b.player_id AND a.item_id < b.item_id
  WHERE a.boss IS NOT NULL;
