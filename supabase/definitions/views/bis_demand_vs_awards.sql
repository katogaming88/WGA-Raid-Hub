-- View public.bis_demand_vs_awards: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.bis_demand_vs_awards with (security_invoker=on) as
 WITH demand AS (
         SELECT p.team_id,
            ip.item_id,
            count(DISTINCT ip.player_id) AS demand_count
           FROM item_preferences ip
             JOIN players p ON p.id = ip.player_id
             JOIN items i_1 ON i_1.id = ip.item_id
          WHERE p.archived_at IS NULL AND ip.status = 'bis'::text AND NOT i_1.is_placeholder
          GROUP BY p.team_id, ip.item_id
        ), awards AS (
         SELECT rclc_loot.team_id,
            rclc_loot.item_id,
            rclc_loot.season,
            count(*) AS awarded_count
           FROM rclc_loot
          WHERE rclc_loot.item_id IS NOT NULL
          GROUP BY rclc_loot.team_id, rclc_loot.item_id, rclc_loot.season
        )
 SELECT d.team_id,
    d.item_id,
    i.name AS item_name,
    i.slot,
    d.demand_count,
    a.season,
    COALESCE(a.awarded_count, 0::bigint) AS awarded_count
   FROM demand d
     JOIN items i ON i.id = d.item_id
     LEFT JOIN awards a ON a.team_id = d.team_id AND a.item_id = d.item_id
  ORDER BY d.team_id, d.demand_count DESC, (COALESCE(a.awarded_count, 0::bigint));
