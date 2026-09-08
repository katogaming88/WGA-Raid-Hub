-- #1010: anon loses execute on submit_season_signup, matching production.
--
-- Two migrations define this function a day apart and sort in the opposite
-- order to the one they were written in. 20260726104516 grants anon and was
-- added 2026-07-15 (#505) carrying a timestamp eleven days ahead of its
-- commit, so it sorts after 20260716210158, which revoked anon and was added
-- 2026-07-16 (#513). A replay therefore ends on the older definition.
-- Production applied each when its PR merged, so it took them in the order
-- they were written and never carried the re-grant. Found by the T3
-- set-equality test in this PR, on its first run.
--
-- This closes the grant half. The body half, where a replay also loses the
-- null auth.uid() raise, is #1020.

revoke execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  from anon;
