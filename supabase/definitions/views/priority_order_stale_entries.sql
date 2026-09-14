-- View public.priority_order_stale_entries: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.priority_order_stale_entries with (security_invoker=on) as
 SELECT po.id AS priority_order_id,
    po.team_id,
    po.season,
    po.item_id,
    i.name AS item_name,
    po.track,
    po.rank,
    po.player_id,
    p.name_realm,
    p.archived_at
   FROM priority_order po
     JOIN players p ON p.id = po.player_id
     JOIN items i ON i.id = po.item_id
  WHERE p.archived_at IS NOT NULL
  ORDER BY po.team_id, po.season, i.name, po.track, po.rank;
