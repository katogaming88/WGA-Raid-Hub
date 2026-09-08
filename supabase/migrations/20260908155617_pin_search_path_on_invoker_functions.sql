-- #1010: pin search_path on the twelve SECURITY INVOKER functions. The 59
-- SECURITY DEFINER functions have pinned theirs since July.
--
-- Three of the twelve resolve relations through the search path rather than
-- qualifying them: check_team_id_matches_player, claim_raid_signup_sheet and
-- wishlist_setup_status. All three are anon-executable, which is why this is
-- worth doing rather than tidy. It is not reachable today, because neither
-- anon nor authenticated holds CREATE on the database or on public, so
-- neither can put a relation ahead of public on the path, and PostgREST
-- offers no route to DDL or to set search_path.
--
-- No bodies change.

alter function public.archive_current_season(integer, jsonb) set search_path = public;
alter function public.check_boe_status_transition() set search_path = public;
alter function public.check_team_id_matches_boe_item() set search_path = public;
alter function public.check_team_id_matches_player() set search_path = public;
alter function public.claim_raid_signup_sheet(integer, date, text) set search_path = public;
alter function public.restrict_bis_items_update_to_obtained() set search_path = public;
alter function public.restrict_item_preferences_officer_update_to_note_clear() set search_path = public;
alter function public.restrict_players_self_update_to_bonus_roll() set search_path = public;
alter function public.set_team_setting(integer, jsonb, boolean) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.unarchive_season(integer, integer) set search_path = public;
alter function public.wishlist_setup_status(integer) set search_path = public;
