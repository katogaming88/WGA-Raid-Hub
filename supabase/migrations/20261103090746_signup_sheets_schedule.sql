-- #960: the Discord signup sheets move off the VM into discord-bot-webhook.
--
-- The bot process posted each raid night's sheet from a timer of its own.
-- From here pg_cron calls discord-bot-webhook's signupSheets action every 15
-- minutes, with the same job secret as the post queue's drain and the
-- optional-night reminders. Each run posts the sheets that are due by the
-- team's settings on Settings > Discord and brings every posted sheet of a
-- raid not yet passed up to date. Nothing about the tables changes:
-- raid_signup_sheets and claim_raid_signup_sheet() keep the message ids as
-- they did for the bot.
--
-- The local stack never fires it: seed.sql deactivates every pg_cron job.
do $$
begin
  perform cron.unschedule('discord-signup-sheets');
exception when others then
  null;
end $$;

select cron.schedule(
  'discord-signup-sheets',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/discord-bot-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'optional_rsvp_reminders_secret')
    ),
    body := '{"action":"signupSheets"}'::jsonb
  );
  $cron$
);

comment on table public.raid_signup_sheets is
  'Which Discord message holds each team''s signup sheet for a raid night (#900): one edited-in-place embed per team and raid_date. Written and read only by the service role, through claim_raid_signup_sheet(), by discord-bot-webhook and discord-interactions since #960 (the bot process before). No read use case for an officer or end user. Mirrors raid_rsvp_reminders_sent''s locked-down shape (#895).';
