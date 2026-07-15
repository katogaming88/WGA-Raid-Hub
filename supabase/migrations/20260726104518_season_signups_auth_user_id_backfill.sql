-- One-time backfill: link auth_user_id on existing season_signups to their
-- claimed account, for signups submitted before #500 existed (auth_user_id
-- was never captured pre-#500's submit_season_signup change, so every row
-- created before this migration is NULL regardless of whether the submitter
-- was logged in at the time). Without this, the currently pending/approved
-- signups already in production would need an officer hand-patch forever
-- even after self-edit ships -- exactly the gap #500 exists to close.
--
-- Matches signup_name_realm to an unarchived players row on the same team,
-- then to that player's claimed team_members.auth_user_id -- the same
-- name_realm-to-claim resolution claim_character() itself relies on
-- (players.team_id + name_realm is expected unique among unarchived rows).
-- Only backfills where a claim already exists; anything unclaimed or with no
-- matching player is left NULL, same as any signup submitted while signed out.
update public.season_signups s
set auth_user_id = tm.auth_user_id
from public.players p
join public.team_members tm on tm.id = p.team_member_id
where s.auth_user_id is null
  and p.team_id = s.team_id
  and p.archived_at is null
  and lower(p.name_realm) = lower(s.signup_name_realm)
  and tm.auth_user_id is not null;
