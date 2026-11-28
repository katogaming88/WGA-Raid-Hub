-- View public.season_loot_pace: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.season_loot_pace with (security_invoker=on) as
 WITH responses AS MATERIALIZED (
         SELECT DISTINCT rclc_loot.team_id,
            rclc_loot.response
           FROM rclc_loot
        ), counted AS MATERIALIZED (
         SELECT responses.team_id,
            responses.response
           FROM responses
          WHERE loot_award_counts_as(responses.team_id, responses.response) = ANY (ARRAY['main'::text, 'off'::text])
        ), awards AS (
         SELECT rl_1.team_id,
            rl_1.season,
            rl_1.awarded_at,
            rl_1.track,
            rl_1.item_id
           FROM rclc_loot rl_1
             JOIN counted c ON c.team_id = rl_1.team_id AND NOT c.response IS DISTINCT FROM rl_1.response
        ), season_bounds AS (
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
   FROM awards rl
     JOIN season_bounds sb ON sb.team_id = rl.team_id AND sb.season = rl.season
     LEFT JOIN items i ON i.id = rl.item_id
  GROUP BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1), rl.track, i.slot
  ORDER BY rl.team_id, rl.season, (floor(EXTRACT(epoch FROM rl.awarded_at - sb.season_start) / (7 * 86400)::numeric)::integer + 1);
