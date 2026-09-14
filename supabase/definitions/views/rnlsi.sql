-- View public.rnlsi: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.rnlsi with (security_invoker=on) as
 SELECT p.id AS player_id,
    p.team_id,
    p.name_realm,
    cs.role,
    la.last_award_at,
    ( SELECT count(DISTINCT a.raid_date) AS count
           FROM attendance a
          WHERE a.team_id = p.team_id AND (la.last_award_at IS NULL OR a.raid_date > la.last_award_at::date)) AS raid_nights_since_last_item
   FROM players p
     LEFT JOIN classes_specs cs ON cs.id = p.class_spec_id
     LEFT JOIN LATERAL ( SELECT max(rl.awarded_at) AS last_award_at
           FROM rclc_loot rl
          WHERE rl.player_id = p.id) la ON true
  WHERE p.archived_at IS NULL
  ORDER BY p.team_id, cs.role, (( SELECT count(DISTINCT a.raid_date) AS count
           FROM attendance a
          WHERE a.team_id = p.team_id AND (la.last_award_at IS NULL OR a.raid_date > la.last_award_at::date))) DESC;
