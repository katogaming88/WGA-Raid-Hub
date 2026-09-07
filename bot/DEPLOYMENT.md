# Deployment Guide

Both **team-phoenix** and **team-hellfire-rollers** run on the same Oracle Cloud VM from separate clones of
[WGA-Raid-Hub](https://github.com/katogaming88/WGA-Raid-Hub), where the bot lives at `bot/` (#954). Everything
below runs from that subdirectory: the build, the pm2 process, the `.env` file and the nudge log.

This page describes a deployment that is being retired. #997 decided that the bot's runtime stands down
rather than moving: its commands, buttons and sweeps become Edge Functions, and #960 stops both pm2
processes at the end of that work, after which this VM hosts nothing from this project and this file goes
with it. Two other things here are already out of date and stay that way on purpose, since #993 owns them:
#992 moved each team's Discord ids out of these `.env` files into `team_discord_config`, and the two
per-team processes below are what runs today rather than the one process that code was written for.

## Server

- **Provider:** Oracle Cloud Always Free (VM.Standard.E2.1.Micro, Ubuntu 22.04)
- **Public IP:** 129.80.178.227
- **SSH:** `ssh -i C:\Users\kato8\.ssh\ssh-key-2026-06-16.key ubuntu@129.80.178.227`

## Public HTTPS URLs

Caddy runs on the VM as a systemd service and reverse-proxies each bot with automatic HTTPS (Let's Encrypt). Ports 80 and 443 are open in both the Oracle VCN security list and Ubuntu iptables.

| Bot | Public URL | Internal port |
|-----|-----------|---------------|
| team-phoenix | https://wga-phoenix.duckdns.org | 3000 |
| team-hellfire-rollers | https://wga-hellfire.duckdns.org | 3001 |

The Caddyfile lives at `/etc/caddy/Caddyfile`. To reload after changes:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy   # confirm no errors and certs obtained
```

Caddy auto-renews certs and restarts on reboot via systemd -- no manual cert management needed.

## Internal ports

| Bot | Port |
|-----|------|
| team-phoenix | 3000 |
| team-hellfire-rollers | 3001 |

These ports are not exposed directly; all external traffic goes through Caddy on 443.

## Process manager

Bots are managed by pm2 and auto-start on reboot.

| Command | Description |
|---------|-------------|
| `pm2 list` | Check status of all bots |
| `pm2 logs <name>` | View logs |
| `pm2 restart <name>` | Restart a bot |
| `pm2 stop <name>` | Stop a bot |

## Repo locations on server

- team-phoenix: `~/team-phoenix/`, with the bot at `~/team-phoenix/bot/`
- team-hellfire-rollers: `~/team-hellfire-rollers/`, with the bot at `~/team-hellfire-rollers/bot/`

## Deploying an update

```bash
cd ~/team-phoenix   # or ~/team-hellfire-rollers
git pull
cd bot
npm ci        # only when package-lock.json moved
npm run build
pm2 restart team-phoenix   # or team-hellfire-rollers
```

The pull is at the clone root, the build is in `bot/`. Start the pm2 process from inside `bot/` as well, so
`dotenv` finds `.env` and the default nudge-log path resolves under it.

## Environment variables

Each clone has its own `.env` file, at `bot/.env`. Key differences between the two:

- `DISCORD_BOT_TOKEN` -- different bot token per server
- `DISCORD_CHANNEL_ID` -- different channel per server
- `DISCORD_GUILD_ID` -- team-phoenix: `1333287434473177109`, team-hellfire-rollers: `1329669121733951581`
- `APPS_SCRIPT_URL` -- different Apps Script deployment per server (M+ Exclusion Form script, used by /resend)
- `ROSTER_SCRIPT_URL` -- URL of the deployed WGA Raid Hub Apps Script web app (used by roster slash commands)
- `PORT` -- team-phoenix omitted (defaults to 3000), team-hellfire-rollers: `3001`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` -- same WGA Raid Hub Supabase project for both servers (`https://kxgjqnpwfklbgrxdgmmv.supabase.co`); the service role key bypasses row security, so treat it like the bot token (used by `/nudge-missing`)
- `TEAM_ID` -- WGA Raid Hub's own `teams.id`, **not** `DISCORD_GUILD_ID`: team-phoenix: `1`, team-hellfire-rollers: `2` (used by `/nudge-missing`)
- `SITE_URL` -- optional, WGA Raid Hub's own base URL (e.g. `https://raid.example.com`, no trailing `#`/`/profile`). When set, nudge DMs include a deep link straight to the raider's own profile and the specific sub-tab their issue lives on (Wishlist or BiS) -- requires WGA-Raid-Hub#698 to be deployed.
- `NUDGE_LOG_PATH` -- optional, where `/nudge-missing`'s 24h-per-raider cooldown is persisted (defaults to `./data/nudge-log.json`, relative to the process's working directory -- survives `pm2 restart` but not a fresh clone)

## Apps Script integration

The GAS backend (`wgaWebApp.gs`) calls the bot via `BOT_BASE_URL`, read from Script Properties at runtime. Set this in each Apps Script deployment's Project Settings -> Script Properties:

| Deployment | BOT_BASE_URL |
|-----------|--------------|
| Phoenix | `https://wga-phoenix.duckdns.org` |
| Hellfire | `https://wga-hellfire.duckdns.org` |
