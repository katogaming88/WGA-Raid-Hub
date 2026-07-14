-- #493: replace the GitHub Actions cron triggers for twitch-live-check and
-- wcl-progression-sync with pg_cron + pg_net calling the Edge Functions
-- directly from Postgres.
--
-- Both functions were originally put on a GitHub Actions schedule because
-- this project had no pg_cron/pg_net infrastructure at the time (see
-- docs/database-decisions.md, 2026-07-12 entry). In practice, GitHub
-- Actions' scheduled-workflow trigger has never actually honored either
-- workflow's cron expression -- checking twitch-live-check.yml's run
-- history, real gaps between runs have been 1-3 hours the entire time, not
-- the 5 minutes it's scheduled for. That's a real correctness gap for
-- twitch-live-check specifically: the landing-page "who's live" banner/
-- widget trusts streamers.is_live, and a raider going live could show as
-- offline there for up to an hour. Confirmed directly: a raider was live and
-- playable on the Streams tab (which embeds Twitch directly, no is_live
-- dependency) while is_live was still false from a check taken nearly an
-- hour earlier.
--
-- Requires pg_cron and pg_net enabled for this project (Database >
-- Extensions in the dashboard, or this migration's CREATE EXTENSION lines
-- below if the plan allows enabling via SQL). If those fail with a
-- permission error, enable both extensions via the dashboard toggle first,
-- then re-run this migration.
--
-- The shared secrets (TWITCH_LIVE_CHECK_SECRET / WCL_PROGRESS_SYNC_SECRET)
-- are NOT set here -- this migration only schedules the cron jobs assuming
-- both secrets already exist in Supabase Vault under the names referenced
-- below. Run this once, by hand, in the SQL Editor (never commit real
-- secret values to a migration file):
--
--   select vault.create_secret('<the TWITCH_LIVE_CHECK_SECRET value>', 'twitch_live_check_secret', 'Shared secret for twitch-live-check pg_cron caller');
--   select vault.create_secret('<the WCL_PROGRESS_SYNC_SECRET value>', 'wcl_progress_sync_secret', 'Shared secret for wcl-progression-sync pg_cron caller');
--
-- Both values already exist as repo secrets (GitHub Settings > Secrets and
-- variables > Actions) and as Edge Function secrets (Project Settings >
-- Edge Functions > Secrets) -- reuse the same values here, don't generate
-- new ones, or the Edge Functions' 401 check will reject pg_cron's calls.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Idempotent re-run: cron.schedule() with a name already in use creates a
-- second duplicate job on some pg_cron versions rather than replacing it,
-- so unschedule first (ignoring "job not found" on a first-ever run).
do $$
begin
  perform cron.unschedule('twitch-live-check');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('wcl-progression-sync');
exception when others then
  null;
end $$;

-- Every 5 minutes, matching the GitHub Actions schedule this replaces
-- (.github/workflows/twitch-live-check.yml).
select cron.schedule(
  'twitch-live-check',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/twitch-live-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'twitch_live_check_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Tue/Thu/Mon 9:30pm-midnight Eastern, padded an hour each side for DST,
-- matching .github/workflows/wcl-progression-sync.yml's schedule exactly
-- (see that file's header comment for the UTC/DST math -- unchanged here).
select cron.schedule(
  'wcl-progression-sync',
  '0,30 1-5 * * 2,3,5',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/wcl-progression-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wcl_progress_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
