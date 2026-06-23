# Stress Testing Guide

Steps to run a user stress test against a copy of the app without touching production data.

## Setup

### 1. Copy the Google Sheet

- Open the production spreadsheet for the team you want to test
- File -> Make a copy
- This copies all tabs, data, and the bound Apps Script automatically

### 2. Deploy the copied Apps Script

- Open the copied Sheet -> Extensions -> Apps Script
- Deploy -> New deployment -> Web App
- Execute as: Me; Access: Anyone
- Copy the generated deployment URL (`https://script.google.com/macros/s/.../exec`)

### 3. Copy Script Properties

The GAS backend relies on several Script Properties that are NOT copied with the sheet.
In the copied Apps Script: Project Settings -> Script Properties -> Add the following:

| Property | Where to find it |
|---|---|
| `DISCORD_CLIENT_ID` | Copy from production |
| `DISCORD_CLIENT_SECRET` | Copy from production |
| `officerDiscordIds` | Copy from production (comma-separated Discord IDs) |
| `adminDiscordIds` | Copy from production |

Discord session tokens (`discordSession_<token>`) do not need to be copied -- testers will log in fresh.

### 4. Add a test team entry in the frontend

In `js/common.js`, add a test entry to the `TEAMS` object (around line 1):

```javascript
var TEAMS = {
  phoenix: { ... },   // production -- do not change
  hellfire: { ... },  // production -- do not change
  test: {
    gasUrl: 'https://script.google.com/macros/s/<YOUR_TEST_DEPLOYMENT_ID>/exec',
    name: 'Test Team',
    officerPass: 'phoenix2'  // same as whichever team you copied
  }
};
```

Testers access the test environment by appending `?team=test` to the URL:
- Public page: `https://katogaming88.github.io/WGA-Raid-Hub/index.html?team=test`
- Officer page: `https://katogaming88.github.io/WGA-Raid-Hub/officer.html?team=test`

Production teams are unaffected.

### 5. Discord OAuth on localhost

Discord OAuth is automatically disabled on `localhost` / `127.0.0.1` -- the login popup is skipped and no session is attempted. This means:

- Localhost is fine for testing all non-Discord flows (roster, loot, attendance, officer writes)
- To test the Discord login flow end-to-end, use the GitHub Pages URL with `?team=test`

## Cleanup

- Remove the `test` entry from `TEAMS` in `js/common.js` when done
- Delete the copied Sheet and its Apps Script deployment
- Discord session tokens in the test deployment's Script Properties will expire on their own (30-day TTL)
