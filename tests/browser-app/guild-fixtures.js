import { TEAMS, TEAM_SETTINGS, STREAMS, OFFICER_BIOS } from '../behavior/guild.js';

// Guild home's reads (#1102) as the new app asks for them, shared by
// guild.test.js and the accessibility states in app.test.js.

export const GUILD_TEAMS = TEAMS;

// The app reads each team's settings as named fields, not the whole config.
const SETTINGS = TEAM_SETTINGS.map((r) => ({
  team_id: r.team_id,
  signups_open: r.config.signupsOpen,
  logs: r.config.externalLinks.warcraftLogsUrl ?? null,
  raids: []
}));

export const GUILD_TABLES = {
  team_settings: SETTINGS,
  streamers: STREAMS,
  site_settings: [{ guild_officer_bios: OFFICER_BIOS }],
  players: [
    { team_id: 1, classes_specs: { role: 'Tank' } },
    { team_id: 1, classes_specs: { role: 'Heal' } },
    { team_id: 2, classes_specs: { role: 'Melee' } }
  ]
};

// Three received-item reviews and one unpriced BoE find waiting on Phoenix.
export const WAITING = {
  self_received_requests: [{ id: 1 }, { id: 2 }, { id: 3 }],
  boe_items: [{ id: 9 }]
};
