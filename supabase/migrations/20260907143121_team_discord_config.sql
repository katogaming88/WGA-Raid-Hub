-- #991: per-team Discord infra config for the consolidated multi-tenant
-- bot. Today's bot is one full deployment per team, with the guild id,
-- channel ids, ping role ids and script URLs baked in as env vars for
-- whichever single team that process serves. Consolidating into one bot
-- process (one Discord Application, reads every team's config at runtime)
-- needs somewhere to look that up from instead.
--
-- Not folded into team_settings.config: that jsonb blob is raider-visible
-- feature-toggle/season state (seasonName, signupsOpen, etc.), read by every
-- page load. This is bot-only infra wiring with no raider-facing use case at
-- all, so it gets its own table locked down the same way raid_signup_sheets
-- (#900) and raid_rsvp_reminders_sent (#895) are -- no anon/authenticated
-- read policy, only the bot's own service-role client (which bypasses RLS
-- regardless) and claude_readers for inspection.
--
-- No webhook secret column here -- per Kat's call, the consolidated bot
-- validates every relay call against one shared BOT_WEBHOOK_SECRET env var
-- (matching the edge function's own single BOT_WEBHOOK_SECRET), not a
-- per-team value. There is exactly one trusted caller (the relay) regardless
-- of which team's payload it carries, so per-team secrets added isolation
-- with no real security benefit here, at the cost of provisioning every
-- team's secret in two places.
--
-- attendance_channel_id/signup_channel_id are nullable and fall back to
-- officer_channel_id in the bot's own lookup code -- preserves today's
-- behavior, where ATTENDANCE_CHANNEL_ID already defaults to CHANNEL_ID.
-- signup_channel_id supersedes team_settings.config's discordSignupChannelId
-- (added with #900's signup sheet, read by signupSheet.ts, but never
-- actually set for either team and with no write path anywhere) -- one
-- consistent home for every Discord channel/role/script id the bot needs,
-- instead of this one config value living apart from the rest.
--
-- No site_url column: unlike guild/channel/role ids, the deployed site is
-- the same GitHub Pages URL for every team (?team= distinguishes them at
-- the URL level, not a separate deployment) -- that stays a single global
-- SITE_URL env var, not per-team config.
--
-- Bootstrapping the two existing teams' real values (guild/channel/role ids
-- already live in the VM's current .env files) is not part of this
-- migration -- same precedent as wcl_guild_id (20260722100000): set directly
-- via the SQL Editor once gathered, no write path exists yet.
create table "public"."team_discord_config" (
    "team_id" integer primary key references "public"."teams"("id") on delete cascade,
    "guild_id" text not null,
    "officer_channel_id" text not null,
    "attendance_channel_id" text,
    "signup_channel_id" text,
    "mplus_ping_role_id" text,
    "roster_ping_role_id" text,
    "rsvp_ping_role_id" text,
    "apps_script_url" text,
    "roster_script_url" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);

comment on table public.team_discord_config is
  'Per-team Discord infra config for the consolidated multi-tenant bot (#991): guild/channel/role ids and script URLs the bot needs to route a relayed action to the right place. Written and read only by the bot''s service-role client; no read use case for an officer or end user. Mirrors raid_signup_sheets'' locked-down shape (#900).';

alter table "public"."team_discord_config" owner to "postgres";
alter table "public"."team_discord_config" enable row level security;

create policy "Claude readers read team_discord_config" on "public"."team_discord_config" for select to "claude_readers" using (true);

-- No other grants: locked to the service role (and claude_readers) only,
-- same as raid_signup_sheets/raid_rsvp_reminders_sent.
