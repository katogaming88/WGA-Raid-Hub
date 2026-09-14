-- View public.priority_order_live_first_prios: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.priority_order_live_first_prios with (security_invoker=on) as
 SELECT po.id AS priority_order_id,
    po.team_id,
    po.season,
    po.item_id,
    i.name AS item_name,
    po.track,
    po.player_id,
    p.name_realm,
    ib.boss
   FROM priority_order po
     JOIN items i ON i.id = po.item_id
     JOIN players p ON p.id = po.player_id
     LEFT JOIN item_bosses ib ON ib.item_id = po.item_id
  WHERE po.rank = 1 AND NOT (EXISTS ( SELECT 1
           FROM rclc_loot rl
          WHERE rl.team_id = po.team_id AND rl.season = po.season AND rl.item_id = po.item_id AND rl.track = po.track AND rl.player_id = po.player_id)) AND NOT (EXISTS ( SELECT 1
           FROM self_received_requests sr
          WHERE sr.status = 'approved'::text AND sr.team_id = po.team_id AND sr.self_item_id = po.item_id AND sr.track = po.track AND sr.player_id = po.player_id));
