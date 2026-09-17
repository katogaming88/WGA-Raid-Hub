// How Guild home behaves, written once and checked against both sites (#1102
// step 1). tests/browser/guild-recorded.test.js runs it against the current
// site's guild.html, where it was recorded; tests/browser-app/guild.test.js
// runs the same checks against the new app's Guild home.
//
// The new page is a redesign (Kat, 2026-09-17, option B on the canvas), so
// what is recorded here is what it must keep doing, not how it looks:
//
//   teams:    [{ name, mine, signup, logs }]   one card per team, in order;
//                                             `logs` is the link or null
//   live:     [name]                          who is live, in read order
//   news:     [{ title, date }]               the three newest entries
//   officers: [{ name, title }]               guild officers, in order
//   links:    { raiderIo, armory }
//
// Deliberate differences, checked by the new suite only:
// - Offline streamers are listed on the Streams page, not here, and with
//   nobody live the Live now section is not shown at all (the current page
//   says "No one is live right now." above an offline list).
// - Every team that is not archived gets a card, Wrathless included (Kat,
//   2026-09-17). The current page hides Wrathless with a flag in js/common.js.
// - "Your team" marks every team the reader has a current character on. The
//   current page marks one only when there is exactly one, because it also
//   picks where its links go; the new page's cards each link to their own team.
// - Officers see a Needs your attention panel with their team's waiting
//   received-item reviews, season signups and unpriced BoE finds.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The three teams the current site lists, in the order both sites show them.
export const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null },
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null },
  { id: 3, name: 'Immolation', slug: 'immolation', archived_at: null }
];

const LOGS = {
  1: 'https://www.warcraftlogs.com/guild/id/111111',
  2: 'https://www.warcraftlogs.com/guild/id/222222'
};

// Phoenix and Immolation are taking signups; Immolation has no logs link.
export const TEAM_SETTINGS = [
  { team_id: 1, config: { signupsOpen: true, externalLinks: { warcraftLogsUrl: LOGS[1] } } },
  { team_id: 2, config: { signupsOpen: false, externalLinks: { warcraftLogsUrl: LOGS[2] } } },
  { team_id: 3, config: { signupsOpen: true, externalLinks: {} } }
];

export const EXPECTED_TEAMS = [
  { name: 'Phoenix', mine: false, signup: true, logs: LOGS[1] },
  { name: 'Hellfire Rollers', mine: false, signup: false, logs: LOGS[2] },
  { name: 'Immolation', mine: false, signup: true, logs: null }
];

// Signed in with a current character on Hellfire Rollers only.
export const MEMBER = {
  userId: '00000000-0000-4000-8000-000000000042',
  discordId: 'discord-member-42',
  name: 'Kestrel',
  nameRealm: 'Kestrel-Illidan',
  teamId: 2
};

export const EXPECTED_MEMBER_TEAMS = EXPECTED_TEAMS.map((t) => ({ ...t, mine: t.name === 'Hellfire Rollers' }));

// A character that has been archived is not a claim on its team (#941).
export const ARCHIVED_AT = '2026-03-01T00:00:00+00:00';

const streamer = (id, teamId, nameRealm, nickname, channel, live, optOut = false) => ({
  id,
  team_id: teamId,
  player_id: id,
  twitch_channel: channel,
  schedule_note: '',
  guild_wide_opt_out: optOut,
  is_live: live,
  players: { name_realm: nameRealm, nickname }
});

// Two live, one live but opted out of other teams' pages (and on this page
// every reader counts as another team), and one offline.
export const STREAMS = [
  streamer(1, 1, 'Aurelith-Illidan', 'Aur', 'aurelithplays', true),
  streamer(2, 2, 'Kestrel-Illidan', null, 'kestrelraids', true),
  streamer(3, 3, 'Zephyra-Illidan', 'Zed', 'zedstreams', true, true),
  streamer(4, 1, 'Cinderfall-Illidan', 'Cinder', 'cinderfallvods', false)
];

export const EXPECTED_LIVE = ['Aur', 'Kestrel'];

export const NOBODY_LIVE = STREAMS.map((s) => ({ ...s, is_live: false }));

// news.json itself: both sites read the same file, pinned entries first, then
// newest first.
function newsOrder() {
  const entries = JSON.parse(readFileSync(join(ROOT, 'news.json'), 'utf8'));
  return entries.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.date === b.date) return 0;
    return a.date < b.date ? 1 : -1;
  });
}

export const EXPECTED_NEWS = newsOrder()
  .slice(0, 3)
  .map((e) => ({ title: e.title, date: e.date }));

export const OFFICER_BIOS = [
  {
    name: 'Aurelith',
    title: 'Guild Master',
    characterName: 'Aurelith',
    classKey: 'Paladin',
    spec: 'Holy',
    pronouns: 'she/her',
    bio: 'Runs the guild.'
  },
  { name: 'Cinderfall', title: 'Officer', bio: 'Handles recruitment and the BoE ledger.' }
];

export const EXPECTED_OFFICERS = OFFICER_BIOS.map((b) => ({ name: b.name, title: b.title }));

export const LINKS = {
  raiderIo: 'https://raider.io/guilds/us/tichondrius/We%20Go%20Again',
  armory: 'https://worldofwarcraft.com/en-us/guild/us/tichondrius/we-go-again'
};
