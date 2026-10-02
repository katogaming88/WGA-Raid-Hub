-- View public.team_raid_kills_this_week: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): anon, authenticated

create or replace view public.team_raid_kills_this_week with (security_invoker=on) as
 SELECT DISTINCT ON (k.team_id, k.encounter_id, k.difficulty) k.team_id,
    k.encounter_id,
    e.name AS encounter_name,
    k.difficulty,
    k.raid_date,
    k.report_code,
    k.fight_id
   FROM team_raid_kills k
     JOIN raid_encounters e ON e.id = k.encounter_id
  WHERE lockout_week_start(k.raid_date) = lockout_week_start(raid_today())
  ORDER BY k.team_id, k.encounter_id, k.difficulty, k.raid_date, k.id;
