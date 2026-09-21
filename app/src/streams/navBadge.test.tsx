import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { seededHandlers } from '../test/fakeSupabase';

// The sidebar's live count on the Streams item (#1102).

const streamer = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  team_id: 1,
  twitch_channel: `channel${id}`,
  schedule_note: null,
  guild_wide_opt_out: false,
  is_live: true,
  players: { name_realm: `Raider${id}-Illidan`, nickname: null },
  ...extra
});

const withStreamers = (rows: unknown[]) => {
  const base = seededHandlers();
  return seededHandlers({
    from: (read) => (read.table === 'streamers' ? { data: rows } : base.from!(read))
  });
};

describe('the Streams item’s live count', () => {
  it('counts who the Streams page lists as live, and says so in words', async () => {
    // Two live, one offline, one live who opted out (the page leaves them out).
    renderApp(
      '/g/wga/t/phoenix/roster',
      withStreamers([
        streamer(1),
        streamer(2),
        streamer(3, { is_live: false }),
        streamer(4, { guild_wide_opt_out: true })
      ])
    );
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const link = await within(nav).findByRole('link', { name: 'Streams, 2 live' });
    expect(link).toHaveTextContent('2');
  });

  it('shows no count when nobody is live', async () => {
    renderApp('/g/wga/t/phoenix/roster', withStreamers([streamer(1, { is_live: false })]));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Streams' })).toHaveTextContent(/^Streams$/);
  });
});
