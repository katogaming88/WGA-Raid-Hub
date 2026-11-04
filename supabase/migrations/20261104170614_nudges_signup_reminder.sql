-- #990: discord_nudges_sent takes a fourth category, 'signup-reminder'.
--
-- /officer missing-signups has a "DM them a reminder" button. It DMs each
-- raider the signup link at most once a day, and that day is the same
-- one-row-per-Discord-id-and-category cooldown /officer nudge-missing already
-- keeps here. Without the new value the function's insert would be refused
-- by the category check and a raider could be reminded again on every press.
--
-- Nothing else changes: same columns, same service-role-only grants.

alter table public.discord_nudges_sent drop constraint discord_nudges_sent_category_check;

alter table public.discord_nudges_sent
  add constraint discord_nudges_sent_category_check
  check (category in ('no-wishlist', 'no-bis-link', 'incomplete-wishlist', 'signup-reminder'));

comment on table public.discord_nudges_sent is
  'When the bot last DMed each Discord user about each thing it chases: a missing wishlist, BiS link or BiS pick (/officer nudge-missing, #998) or a season signup (/officer missing-signups, #990). One row per Discord id and category, overwritten on each DM, so the 24-hour cooldown holds across every team. Written by discord-interactions with the service role, after the DM was sent.';
