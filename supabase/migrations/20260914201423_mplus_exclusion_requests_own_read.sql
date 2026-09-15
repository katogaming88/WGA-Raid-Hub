-- Raiders can read their own mplus_exclusion_requests rows (#868).
--
-- Only officers, team leaders and site admins could read this table, so a
-- raider whose request was rejected never saw it: the current site's profile
-- shows "Rejected" and the officer's note from a read that returned nothing
-- for them. Kat decided on 2026-09-14 that a raider sees their own request
-- and the officer's note, so they know why and can re-submit.
--
-- Same rule as "Raiders read own self_received_requests": the caller's own
-- active characters, every status, since a raider's own pending or rejected
-- submission is theirs to see. Written in the once-per-query shape from
-- 20260913215012 (#1106), comparing against my_active_player_ids() in a
-- scalar subquery rather than calling is_own_player() for every row.
create policy "Raiders read own mplus_exclusion_requests"
on public.mplus_exclusion_requests
for select
using ((player_id = ANY ((SELECT public.my_active_player_ids())::integer[])));
