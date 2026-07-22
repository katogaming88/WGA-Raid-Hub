# Backups & Recovery

Nightly logical dumps of the Supabase database, shipped off-provider to Cloudflare R2 -- the Supabase free tier has no PITR or automated backups, so this is the only recovery path for in-app data today.

This doc covers what exists and why. For actual step-by-step recovery instructions and the restore drill, see the runbook (#544).

## Setup

- **R2 bucket** (`wga-raid-hub-backups`): see #541 for how it and its scoped API token were created.
- **Repo secrets**: `SUPABASE_DB_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` -- see #542.
- **The workflow**: `.github/workflows/db-backup.yml`, runs nightly (~10:00 UTC) plus manual `workflow_dispatch`. See the workflow's own header comment for the full mechanics (dump, restore-verification, upload).

## What gets backed up

Two objects per run, at `pg/wga-<YYYY-MM-DD>.dump` and `pg/wga-auth-<YYYY-MM-DD>.dump` in the bucket:

- **`pg/wga-<date>.dump`** -- `pg_dump -Fc` of the entire `public` schema (schema + data). Standalone restorable; this is the artifact that matters for actual recovery.
- **`pg/wga-auth-<date>.dump`** -- `pg_dump -Fc --data-only` of the `auth` schema (`auth.users` + identities only). Kept as a relink reference for `team_members.auth_user_id` -- `auth`'s own table structure is Supabase-managed, not ours to back up structurally.

## Coverage map: what's regenerable vs. backup-only

**Regenerable without a backup** -- these can be rebuilt from other sources if lost:

- The schema itself, from `supabase/migrations/`.
- `items`/`item_bosses` (the loot catalog), from `scripts/fetch-items.js` + the manual SQL import workflow (`docs/updating-fetch-items-for-new-tier.md`).
- `raid_zones`/`raid_encounters`, re-derivable from Warcraft Logs.
- Static reference data (`classes_specs` and similar).

**In-app-only -- a lost/corrupted row here has no other source, and is only recoverable from a backup:**

- `season_signups`
- `bis_requests`
- `self_received_requests`
- `mplus_exclusion_requests`
- `players.officer_notes`
- `team_settings` (including officer bios stored in `config`)
- `site_settings`
- `audit_log` (post-cutover entries -- pre-cutover history was already lost, see the #377 backfill decision)
- `notifications`
- `streamers`
- `team_members` (Discord claims and auth links)

This second list is exactly why the milestone exists: none of it can be re-fetched or re-derived, and the Danger Zone's clear RPCs make a bad delete a one-click possibility.
