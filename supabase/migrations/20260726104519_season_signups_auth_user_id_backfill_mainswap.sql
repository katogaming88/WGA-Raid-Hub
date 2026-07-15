-- Follow-up to 20260726104518: that backfill only matched
-- signup_name_realm (the new character) against players.name_realm, which
-- misses every main-swap signup -- for those, the new character usually
-- isn't a players row yet at all, and the raider's actual claimed identity
-- lives on swap_from_name_realm (the old character), not signup_name_realm.
-- Confirmed live: 2 of Phoenix's 4 unlinked approved signups were verified-
-- claim main-swaps with a claimed old character sitting right there in
-- swap_from_name_realm, unmatched by the first backfill.
--
-- Same claim resolution as 20260726104518 (players.team_id + name_realm ->
-- team_members.auth_user_id), just matched against swap_from_name_realm
-- instead, and only for main_swap rows that still have no auth_user_id.
-- The free-typed "I'm switching mains" checkbox case (main_swap true, no
-- claim behind it) has swap_from_name_realm null and so is correctly
-- excluded here too -- there's nothing verified to match it to.
update public.season_signups s
set auth_user_id = tm.auth_user_id
from public.players p
join public.team_members tm on tm.id = p.team_member_id
where s.auth_user_id is null
  and s.main_swap
  and s.swap_from_name_realm is not null
  and p.team_id = s.team_id
  and p.archived_at is null
  and lower(p.name_realm) = lower(s.swap_from_name_realm)
  and tm.auth_user_id is not null;
