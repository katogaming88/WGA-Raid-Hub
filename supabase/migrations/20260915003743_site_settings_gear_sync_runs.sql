-- #1174: the gear sweep records its outcome on site_settings, one column for
-- the scheduled run and one for an officer's on-demand sync.
--
-- The daily blizzard-gear-sync sweep wrote nothing on 2026-09-12 to 09-14 and
-- no row said so: cron.job_run_details reports the queue, net._http_response
-- holds a 5 s timeout for a 13 s function, and player_equipped_gear.synced_at
-- moves on any write, so one sync by hand erases the evidence of the missed
-- mornings. From here the function writes what happened at the end of every
-- run: when it started and finished, the trigger, how many players it synced
-- and skipped, and the first error if any. Two columns rather than one key so
-- an officer's "Sync Gear Levels Now" cannot refresh the scheduled sweep's
-- age and hide a dead cron; the Admin tab warns from the cron column.
--
-- Same shape as maintenance_mode and guild_officer_bios on this row: public
-- read through "Public read site_settings", no client write. The writer is
-- the function's service-role client, which is the first writer on this table
-- that is not a SECURITY DEFINER RPC.

alter table public.site_settings
  add column if not exists gear_sync_last_cron_run jsonb,
  add column if not exists gear_sync_last_officer_run jsonb;

comment on column public.site_settings.gear_sync_last_cron_run is
  'Outcome of the last scheduled blizzard-gear-sync sweep, written by the function: trigger, started_at, finished_at, synced, skipped, teams, players, error (first message or null).';
comment on column public.site_settings.gear_sync_last_officer_run is
  'Outcome of the last officer-triggered whole-team blizzard-gear-sync run (Sync Gear Levels Now), same shape as gear_sync_last_cron_run. A single-raider sync is not recorded.';
