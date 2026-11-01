import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import type { DiscordRead, DiscordSettings } from './discord';

// Settings › Discord (#994): an officer picks the server, each kind of post's
// channel and ping, and the signup sheets from lists read from Discord.

const PATH = '/g/wga/t/phoenix/officer/settings/discord';
const SERVER_ID = '100000000000000001';

const person = (role: 'officer' | 'raider') => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Katorrí-Stormrage', url_code: null, archived_at: null }]
    }
  ]
});

const SAVED: DiscordSettings = {
  server_id: SERVER_ID,
  quiet_hours: null,
  posts: [
    { kind: 'officer_requests', channel_id: '201', ping_role_id: '301', last_posted_at: null },
    { kind: 'mplus_requests', channel_id: null, ping_role_id: null, last_posted_at: null },
    { kind: 'rsvp_changes', channel_id: '202', ping_role_id: null, last_posted_at: null }
  ],
  sheets: [
    {
      id: 9,
      channel_id: '203',
      raid_days: [4, 0],
      keep_raids_posted: null,
      hours_before: 48,
      ping_role_id: null,
      last_posted_at: null
    }
  ]
};

const READ: DiscordRead = {
  hasDiscord: true,
  servers: [{ id: SERVER_ID, name: 'We Go Again' }],
  server: {
    id: SERVER_ID,
    name: 'We Go Again',
    botIn: true,
    channels: [
      { id: '201', name: 'phoenix-officers', category: 'OFFICERS', missing: [] },
      { id: '202', name: 'phoenix-attendance', category: 'OFFICERS', missing: ['View Channel'] },
      { id: '203', name: 'thursday-raids', category: 'RAIDS', missing: [] },
      { id: '204', name: 'tuesday-raids', category: 'RAIDS', missing: [] }
    ],
    roles: [
      { id: '301', name: 'Phoenix Officer' },
      { id: '302', name: 'Phoenix Raider' }
    ]
  }
};

function handlers({
  role = 'officer',
  saved = SAVED,
  read = READ,
  rpcs = [],
  invokes = []
}: {
  role?: 'officer' | 'raider';
  saved?: DiscordSettings;
  read?: DiscordRead;
  rpcs?: [string, Record<string, unknown>][];
  invokes?: unknown[];
} = {}): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Katorri#1', discord: { id: 'd', name: 'Katorri' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: person(role) };
      if (name === 'team_discord_settings') return { data: saved };
      if (name.startsWith('set_team_discord') || name.includes('signup_sheet')) {
        rpcs.push([name, args]);
        return { data: null };
      }
      return base.rpc!(name, args);
    },
    invoke(name, args) {
      if (name !== 'discord-settings') return undefined as never;
      const body = (args as { body: { action: string } }).body;
      invokes.push(body);
      return { data: body.action === 'load' ? read : { success: true } };
    }
  });
}

describe('Settings › Discord (#994)', () => {
  it('shows the server, each kind of post, the sheets and quiet hours, by name', async () => {
    renderApp(PATH, handlers());
    expect(await screen.findByRole('heading', { name: 'Discord settings' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Officer requests.*#phoenix-officers, pings @Phoenix Officer/ })
    ).toBeInTheDocument();
    expect(screen.getByText('In the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /M\+ requests.*Off/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /RSVP changes.*The bot can't post in #phoenix-attendance/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /#thursday-raids.*Thursdays and Sundays.*48 hours before each raid/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quiet hours' })).toBeInTheDocument();
  });

  it('turns a kind of post on from the lists, saving ids, never typed', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ rpcs }));
    await userEvent.click(await screen.findByRole('button', { name: /M\+ requests/ }));
    const dialog = await screen.findByRole('dialog', { name: 'M+ requests' });
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Channel'), '#phoenix-officers');
    await userEvent.selectOptions(within(dialog).getByLabelText('Ping'), '@Phoenix Raider');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    await expect.poll(() => rpcs.length).toBe(1);
    expect(rpcs[0]).toEqual([
      'set_team_discord_post',
      { p_team_id: 1, p_kind: 'mplus_requests', p_channel_id: '201', p_ping_role_id: '302' }
    ]);
  });

  it("says what to fix in Discord for a channel the bot can't post in, and sends no test there", async () => {
    renderApp(PATH, handlers());
    await userEvent.click(await screen.findByRole('button', { name: /RSVP changes/ }));
    const dialog = await screen.findByRole('dialog', { name: 'RSVP changes' });
    expect(within(dialog).getByText(/add the WGA Raid Hub role with View Channel on/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send test message' })).toBeDisabled();
  });

  it('turns a kind of post off', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ rpcs }));
    await userEvent.click(await screen.findByRole('button', { name: /Officer requests/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off' }));
    await expect
      .poll(() => rpcs[0]?.[1])
      .toEqual({
        p_team_id: 1,
        p_kind: 'officer_requests',
        p_channel_id: null,
        p_ping_role_id: null
      });
  });

  it('flags a ping role deleted in Discord instead of keeping it quietly', async () => {
    const saved = {
      ...SAVED,
      posts: SAVED.posts.map((p) => (p.kind === 'officer_requests' ? { ...p, ping_role_id: '399' } : p))
    };
    renderApp(PATH, handlers({ saved }));
    expect(
      await screen.findByRole('button', { name: /Officer requests.*its ping role no longer exists/ })
    ).toBeInTheDocument();
  });

  it('sends a test message from a dialog', async () => {
    const invokes: unknown[] = [];
    renderApp(PATH, handlers({ invokes }));
    await userEvent.click(await screen.findByRole('button', { name: /Officer requests/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send test message' }));
    expect(await screen.findByText('Test message sent. Check #phoenix-officers.')).toBeInTheDocument();
    expect(invokes).toContainEqual({ teamId: 1, action: 'test', channelId: '201', kind: 'officer_requests' });
  });

  it("adds a sheet: another sheet's days are taken, and it saves the days picked", async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ rpcs }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add a signup sheet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Signup sheet' });
    expect(within(dialog).getByRole('button', { name: 'Thu' })).toBeDisabled();
    expect(within(dialog).getByText(/Thursday and Sunday are on #thursday-raids\./)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Channel'), '#tuesday-raids');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await expect.poll(() => rpcs.length).toBe(1);
    expect(rpcs[0]).toEqual([
      'save_team_discord_signup_sheet',
      {
        p_team_id: 1,
        p_sheet_id: null,
        p_channel_id: '204',
        p_raid_days: [2],
        p_keep_raids_posted: 2,
        p_hours_before: null,
        p_ping_role_id: null
      }
    ]);
  });

  it('turns quiet hours on', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ rpcs }));
    const card = (await screen.findByRole('heading', { name: 'Quiet hours' })).closest('section')!;
    await userEvent.click(within(card).getByRole('button', { name: 'On' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await expect
      .poll(() => rpcs[0])
      .toEqual([
        'set_team_discord_quiet_hours',
        { p_team_id: 1, p_start: '00:00', p_end: '08:00', p_timezone: 'America/New_York' }
      ]);
  });

  it('a team with no server yet picks one of the servers the officer shares with the bot', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(
      PATH,
      handlers({ rpcs, saved: { ...SAVED, server_id: null, posts: [], sheets: [] }, read: { ...READ, server: null } })
    );
    expect(await screen.findByRole('heading', { name: 'Pick your team’s server' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await expect.poll(() => rpcs[0]).toEqual(['set_team_discord_server', { p_team_id: 1, p_server_id: SERVER_ID }]);
  });

  it('offers to add the bot when it is in none of the officer’s servers', async () => {
    renderApp(
      PATH,
      handlers({ saved: { ...SAVED, server_id: null }, read: { hasDiscord: true, servers: [], server: null } })
    );
    const add = await screen.findByRole('link', { name: 'Add WGA Raid Hub to Discord' });
    expect(add.getAttribute('href')).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?client_id=/);
  });

  it('asks for Discord first on an account without it', async () => {
    renderApp(
      PATH,
      handlers({ saved: { ...SAVED, server_id: null }, read: { hasDiscord: false, servers: [], server: null } })
    );
    expect(await screen.findByRole('button', { name: 'Connect Discord' })).toBeInTheDocument();
  });

  it('a raider gets the closed page, and Discord is never asked', async () => {
    const invokes: unknown[] = [];
    renderApp(PATH, handlers({ role: 'raider', invokes }));
    expect(await screen.findByText(/This page is for officers/)).toBeInTheDocument();
    expect(invokes).toEqual([]);
  });

  it('is in the Settings menu', async () => {
    renderApp(PATH, handlers());
    expect(await screen.findByRole('link', { name: 'Discord' })).toHaveAttribute('href', PATH);
  });
});
