-- #998: /nudge-missing's 24-hour cooldown moves from a JSON file on the VM
-- into the database, for the discord-interactions Edge Function.
--
-- The bot kept one file per process, keyed discordId:category, so a raider
-- on two teams could be nudged twice for the same thing. One row per Discord
-- id and category here makes the window guild-wide: a raider on two teams is
-- nudged once. That is on purpose.
--
-- The function writes a row only after the DM went out. The file was stamped
-- before the send, so a DM that failed still used up the 24 hours.
--
-- Service role only, like raid_rsvp_reminders_sent: no raider or officer
-- reads it, and the function reads and writes it with the service role.

create table public.discord_nudges_sent (
  discord_id text not null,
  category text not null check (category in ('no-wishlist', 'no-bis-link', 'incomplete-wishlist')),
  sent_at timestamp with time zone not null default now(),
  primary key (discord_id, category)
);

comment on table public.discord_nudges_sent is
  'When /nudge-missing last DMed each Discord user about each thing missing from their loot setup (#998). One row per Discord id and category, overwritten on each DM, so the 24-hour cooldown holds across every team. Written by discord-interactions with the service role, after the DM was sent.';

alter table public.discord_nudges_sent owner to postgres;

alter table public.discord_nudges_sent enable row level security;

create policy "Claude readers read discord_nudges_sent" on public.discord_nudges_sent
  for select to claude_readers using (true);

revoke all on table public.discord_nudges_sent from public, anon, authenticated, service_role;
grant select, insert, update on table public.discord_nudges_sent to service_role;
grant select on table public.discord_nudges_sent to claude_readers;
