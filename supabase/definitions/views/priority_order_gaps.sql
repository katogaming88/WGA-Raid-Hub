-- View public.priority_order_gaps: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.priority_order_gaps with (security_invoker=on) as
 SELECT DISTINCT s.team_id,
    s.season,
    p.id AS player_id,
    p.name_realm
   FROM ( SELECT DISTINCT priority_order.team_id,
            priority_order.season
           FROM priority_order) s
     JOIN players p ON p.team_id = s.team_id
  WHERE p.archived_at IS NULL AND NOT p.is_bench AND NOT (EXISTS ( SELECT 1
           FROM priority_order po
          WHERE po.team_id = s.team_id AND po.season = s.season AND po.player_id = p.id))
  ORDER BY s.team_id, s.season, p.name_realm;
