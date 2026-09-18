import { describe, it, expect } from 'vitest';
import { streamDirectory } from './directory';
import type { StreamerRow } from './streams';

// The Streams page's rule against the behavior recorded in
// tests/behavior/streams.js. The fixture is repeated here rather than imported
// because that file describes rendered pages for the browser suites; this one
// only needs rows in, lists out.

const streamer = (
  id: number,
  teamId: number,
  nameRealm: string,
  nickname: string | null,
  channel: string,
  fields: Partial<StreamerRow> = {}
): StreamerRow => ({
  id,
  team_id: teamId,
  twitch_channel: channel,
  schedule_note: '',
  guild_wide_opt_out: false,
  is_live: false,
  players: { name_realm: nameRealm, nickname },
  ...fields
});

const TEAM_NAMES = new Map([
  [1, 'Phoenix'],
  [2, 'Immolation'],
  [3, 'Wrathless']
]);

const ROWS: StreamerRow[] = [
  streamer(1, 1, 'Aurelith-Illidan', 'Aur', 'aurelithplays', {
    is_live: true,
    schedule_note: 'Tue and Thu, 8pm ET'
  }),
  streamer(2, 1, 'Cinderfall-Illidan', 'Cinder', 'cinderfallvods', { schedule_note: 'Weekend mornings' }),
  streamer(3, 2, 'Kestrel-Illidan', null, 'kestrelcasts', { is_live: true }),
  streamer(4, 2, 'Quietone-Illidan', '', 'quietone', { is_live: true, guild_wide_opt_out: true }),
  streamer(5, 3, 'Sleepy-Illidan', '', 'sleepyhealer'),
  streamer(6, 3, '', null, 'ghostchannel', { is_live: true })
];

describe('streamDirectory', () => {
  const directory = () => streamDirectory(ROWS, TEAM_NAMES);

  it('puts whoever is live in the live list, in the order the rows arrived', () => {
    expect(directory().live).toEqual([
      { id: 1, name: 'Aur', channel: 'aurelithplays', team: 'Phoenix', note: 'Tue and Thu, 8pm ET' },
      { id: 3, name: 'Kestrel', channel: 'kestrelcasts', team: 'Immolation', note: '' }
    ]);
  });

  it('puts everyone else in the offline list', () => {
    expect(directory().offline).toEqual([
      { id: 2, name: 'Cinder', channel: 'cinderfallvods', team: 'Phoenix', note: 'Weekend mornings' },
      { id: 5, name: 'Sleepy', channel: 'sleepyhealer', team: 'Wrathless', note: '' }
    ]);
  });

  it('shows a nickname when there is one, and the character’s first name when there is not', () => {
    const names = directory().live.map((s) => s.name);
    expect(names).toContain('Aur');
    expect(names).toContain('Kestrel');
  });

  it('leaves out anyone who asked not to be shown outside their own team', () => {
    const all = [...directory().live, ...directory().offline];
    expect(all.map((s) => s.channel)).not.toContain('quietone');
  });

  it('leaves out a row whose character has no name', () => {
    const all = [...directory().live, ...directory().offline];
    expect(all.map((s) => s.channel)).not.toContain('ghostchannel');
  });

  it('leaves the team blank rather than failing when a team name is missing', () => {
    const { live } = streamDirectory(ROWS, new Map());
    expect(live.map((s) => s.team)).toEqual(['', '']);
  });

  it('gives two empty lists for no streamers at all', () => {
    expect(streamDirectory([], TEAM_NAMES)).toEqual({ live: [], offline: [] });
  });
});
