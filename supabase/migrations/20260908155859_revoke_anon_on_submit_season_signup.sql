-- #1010: anon loses execute on submit_season_signup again, restoring the
-- decision 20260716210158 made and 20260726104516 silently undid.
--
-- 20260716210158 ("require a Discord session to submit a signup") revoked anon
-- deliberately. Ten days later 20260726104516 restated the grants as a "no-op
-- safety net" and wrote `to anon, authenticated`, acting on a header comment
-- that still described the world before that revoke. Production does not carry
-- the anon grant, so this is a no-op there and an alignment everywhere built
-- from the repo, which is where the gap was: a db reset or a rebuilt
-- environment would have restored anonymous signups.
--
-- Found by the T3 set-equality test in this same PR, on its first run.
--
-- The other half of that revert is not addressed here: the body no longer
-- raises when auth.uid() is null, so the guard is one grant deep rather than
-- two. Filed separately; with anon revoked, reaching a null uid needs a role
-- that cannot obtain one.

revoke execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text, text)
  from anon;
