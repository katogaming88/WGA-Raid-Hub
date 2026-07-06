-- Fix #293: two policy defects on player_wcl_season_perf, both from the
-- baseline schema.
--
-- 1. "Officers write player_wcl_season_perf" had asymmetric clauses:
--    USING allowed officer and admin, WITH CHECK allowed only officer,
--    so a team admin could see rows but every INSERT/UPDATE they tried
--    failed the write check. Every other officer-write policy in the
--    schema uses officer, admin in both clauses; this recreates it to
--    match.
--
-- 2. "Public reas player_wcl_season_perf" is renamed to
--    "Public read player_wcl_season_perf" (typo, no behavior change).

drop policy "Officers write player_wcl_season_perf" on "public"."player_wcl_season_perf";
create policy "Officers write player_wcl_season_perf" on "public"."player_wcl_season_perf"
  using ("public"."my_team_role"("team_id") = any (array['officer'::text, 'admin'::text]))
  with check ("public"."my_team_role"("team_id") = any (array['officer'::text, 'admin'::text]));

drop policy "Public reas player_wcl_season_perf" on "public"."player_wcl_season_perf";
create policy "Public read player_wcl_season_perf" on "public"."player_wcl_season_perf"
  for select using (true);
