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
     JOIN team_raid_reports r ON r.team_id = k.team_id AND r.report_code = k.report_code
  WHERE k.raid_date >= lockout_start_at(now()) AND k.raid_date < (lockout_start_at(now()) + 7) AND r.effective_kind = 'main'::text
  ORDER BY k.team_id, k.encounter_id, k.difficulty, k.report_started_at, k.fight_id;
