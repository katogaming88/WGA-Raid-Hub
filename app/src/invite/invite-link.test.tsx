import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The officer Invite link panel (#1264 step 2): copy, expiry, reset.

const OFFICER = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [{ team_id: 1, team_member_id: 1, role: 'officer', characters: [] }]
};

function handlers(current: { code: string; expires_at: string | null } | null): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: OFFICER };
      if (name === 'team_invite_link_reset')
        return { data: { code: 'phoenix-newcode', expires_at: (args['p_expires_at'] as string | null) ?? null } };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'team_invite_links') return { data: current };
      return base.from!(read);
    }
  });
}

describe('the Invite link page', () => {
  it('says there is no link yet, and offers to generate one', async () => {
    renderApp('/g/wga/t/phoenix/officer/invite', handlers(null));
    await screen.findByRole('heading', { level: 1, name: 'Invite link' });
    expect(await screen.findByText('Phoenix has no invite link yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate link' })).toBeInTheDocument();
  });

  it('shows the current link and copies it', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true
    });
    renderApp('/g/wga/t/phoenix/officer/invite', handlers({ code: 'phoenix-abc123', expires_at: null }));
    const input = (await screen.findByLabelText('Current link')) as HTMLInputElement;
    expect(input.value).toContain('/join/phoenix-abc123');
    expect(screen.getByText('No expiry', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('resets the link with the chosen expiry', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    const withCapture: FakeHandlers = {
      ...handlers({ code: 'phoenix-abc123', expires_at: null }),
      rpc(name, args) {
        if (name === 'team_invite_link_reset') seen.push(args);
        return handlers({ code: 'phoenix-abc123', expires_at: null }).rpc!(name, args);
      }
    };
    renderApp('/g/wga/t/phoenix/officer/invite', withCapture);
    await screen.findByLabelText('Current link');
    await user.selectOptions(screen.getByLabelText('Reset with a new link that lasts'), '14');
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(await screen.findByText('Invite link reset. The old one no longer works.')).toBeInTheDocument();
    expect(seen[0]!['p_team_id']).toBe(1);
    expect(typeof seen[0]!['p_expires_at']).toBe('string');
  });
});
