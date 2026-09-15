-- Raiders can read their own mplus_exclusion_requests rows (#868).
--
-- Only officers, team leaders and site admins could read this table, so a
-- raider whose request was rejected never saw it: the current site's profile
-- shows "Rejected" and the officer's note from a read that returned nothing
-- for them. Kat decided on 2026-09-14 that a raider sees their own request
-- and the officer's note, so they know why and can re-submit.
--
-- Same shape as "Raiders read own self_received_requests"
-- (20260824233302): scoped to is_own_player(player_id), every status, since
-- a raider's own pending or rejected submission is theirs to see.
create policy "Raiders read own mplus_exclusion_requests"
on public.mplus_exclusion_requests
for select
using (public.is_own_player(player_id));
