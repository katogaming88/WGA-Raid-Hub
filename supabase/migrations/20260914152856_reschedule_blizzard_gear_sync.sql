-- #1095: move the daily blizzard-gear-sync sweep off the shared :00 second,
-- to 10:07 UTC.
--
-- The sweep wrote nothing on 2026-09-12, 09-13 and 09-14. Its function log for
-- the 09-14 run shows why: the header matched, the Blizzard token came back,
-- the first team_settings read succeeded, and then every PostgREST call for
-- about a minute from 10:00:00 UTC answered 504 Gateway Timeout, five to ten
-- seconds each, while the Blizzard fetches between them kept working. Fired by
-- hand at 19:02 UTC through the same net.http_post and Vault subselect, the
-- same build wrote all 1,303 rows in twenty seconds. cron.job_run_details for
-- those mornings shows jobs 1, 4 and 5 (twitch-live-check, this sweep,
-- optional-rsvp-reminders) queued within four milliseconds of each other at
-- 10:00:00, each in about 25 ms; nothing else of ours runs at that minute.
--
-- 07 shares no minute with the other two jobs (every 5 and every 15), so the
-- sweep no longer lands on a cold API in the same second as two other
-- functions. If the 10:00 window is a platform task rather than the pile-up,
-- the sweep still starts after it. The function itself is unchanged; the
-- schedule is the only difference from 20260831174200_blizzard_gear_sync_cron.
--
-- The local stack never fires this: seed.sql deactivates every pg_cron job
-- (#1055).

do $$
begin
  perform cron.unschedule('blizzard-gear-sync');
exception when others then
  null;
end $$;

select cron.schedule(
  'blizzard-gear-sync',
  '7 10 * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/blizzard-gear-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'blizzard_gear_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
