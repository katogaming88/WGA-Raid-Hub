-- View public.season_loot_pace: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.season_loot_pace with (security_invoker=on) as
 WITH season_bounds AS (
         SELECT rclc_loot.team_id,
            rclc_loot.season,
            min(rclc_loot.awarded_at) AS season_start
           FROM rclc_loot
          GROUP BY rclc_loot.team_id, rclc_loot.season
        )
 SELECT rl.team_id,
    rl.season,
    floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1 AS season_week,
    rl.track,
    i.slot,
    count(*) AS items_awarded
   FROM rclc_loot rl
     JOIN season_bounds sb ON sb.team_id = rl.team_id AND sb.season = rl.season
     LEFT JOIN items i ON i.id = rl.item_id
  GROUP BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1), rl.track, i.slot
  ORDER BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1);
