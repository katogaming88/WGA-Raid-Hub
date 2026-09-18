// How the Streams directory behaves, written once and checked against both
// sites (#1102 step 1). The current site's Streamers tab (js/streamers.js,
// buildStreamersTab) is where the data rules were recorded; tests/browser-app/
// streams.test.js runs the same checks against the new app's Streams page.
//
// Each suite answers the streamers read with STREAMS and turns what the page
// rendered into:
//
//   { live:    [{ name, channel, note, team }],
//     offline: [{ name, channel, note, team }],
//     empty:   message|null }
//
// Deliberate differences from the current site, checked by the new suite only:
// - The page leads with who is live (#797). Today's tab shows this team's
//   streamers first and everyone else after, in no particular order.
// - Only live streamers get a Twitch player. Today's tab builds an embed for
//   every streamer, live or not, which is what made the tab slow to open.
// - It is a guild page, so there is no "this team first": the reader's team
//   does not change the order.
// - An entry with no character name is left out rather than rendered nameless.

const streamer = (id, teamId, nameRealm, nickname, channel, fields = {}) => ({
  id,
  team_id: teamId,
  twitch_channel: channel,
  schedule_note: '',
  guild_wide_opt_out: false,
  is_live: false,
  players: { name_realm: nameRealm, nickname },
  ...fields
});

// The guild's teams, which the page already has from the shell, so a card can
// say which team its streamer raids with.
export const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null },
  { id: 2, name: 'Immolation', slug: 'immolation', archived_at: null },
  { id: 3, name: 'Wrathless', slug: 'wrathless', archived_at: null }
];

// In id order, the order the read returns them: two live, one live but opted
// out of being shown outside their own team, two offline, and one row whose
// character has no name.
export const STREAMS = [
  streamer(1, 1, 'Aurelith-Illidan', 'Aur', 'aurelithplays', {
    is_live: true,
    schedule_note: 'Tue and Thu, 8pm ET'
  }),
  streamer(2, 1, 'Cinderfall-Illidan', 'Cinder', 'cinderfallvods', { schedule_note: 'Weekend mornings' }),
  // No nickname: the card falls back to the character's first name.
  streamer(3, 2, 'Kestrel-Illidan', null, 'kestrelcasts', { is_live: true }),
  // Asked to be shown only on their own team's pages, so not here at all.
  streamer(4, 2, 'Quietone-Illidan', '', 'quietone', { is_live: true, guild_wide_opt_out: true }),
  streamer(5, 3, 'Sleepy-Illidan', '', 'sleepyhealer'),
  // A streamers row whose character record has no name; nothing to label a
  // card with, so it is left out.
  streamer(6, 3, '', null, 'ghostchannel', { is_live: true })
];

export const EXPECTED_STREAMS = {
  live: [
    { name: 'Aur', channel: 'aurelithplays', note: 'Tue and Thu, 8pm ET', team: 'Phoenix' },
    { name: 'Kestrel', channel: 'kestrelcasts', note: '', team: 'Immolation' }
  ],
  offline: [
    { name: 'Cinder', channel: 'cinderfallvods', note: 'Weekend mornings', team: 'Phoenix' },
    { name: 'Sleepy', channel: 'sleepyhealer', note: '', team: 'Wrathless' }
  ],
  empty: null
};

// Nobody live: the page is still worth opening, so the directory stays and
// only the "live now" part goes away.
export const NOBODY_LIVE = STREAMS.map((s) => ({ ...s, is_live: false }));

export const EXPECTED_NOBODY_LIVE = {
  live: [],
  offline: [
    { name: 'Aur', channel: 'aurelithplays', note: 'Tue and Thu, 8pm ET', team: 'Phoenix' },
    { name: 'Cinder', channel: 'cinderfallvods', note: 'Weekend mornings', team: 'Phoenix' },
    { name: 'Kestrel', channel: 'kestrelcasts', note: '', team: 'Immolation' },
    { name: 'Sleepy', channel: 'sleepyhealer', note: '', team: 'Wrathless' }
  ],
  empty: null
};

// No streamers linked at all. The current site says "No streamers linked yet.";
// the new page keeps that wording.
export const NO_STREAMERS = [];

export const EXPECTED_NO_STREAMERS = { live: [], offline: [], empty: 'No streamers linked yet.' };
