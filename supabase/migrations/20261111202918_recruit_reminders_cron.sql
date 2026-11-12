-- #1543: runs the recruit-reminders Edge Function every 15 minutes, the same
-- pg_cron + pg_net shape as optional-rsvp-reminders. The function works out
-- whose turn it is in each open recruit record and sends the team's
-- reminders; recruit_reminders_sent (#1539) keeps each one to once, so a
-- 15-minute sweep makes "2 hours" mean somewhere between 2:00 and 2:15.
--
-- No new secret: it sends the optional_rsvp_reminders_secret vault value,
-- as discord-signup-sheets does, and the function checks it against the
-- OPTIONAL_RSVP_REMINDERS_SECRET it already has.

do $$
begin
  perform cron.unschedule('recruit-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'recruit-reminders',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/recruit-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'optional_rsvp_reminders_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
