import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { toNames, type NameRow } from './names';

describe('toNames', () => {
  it('sorts by label and derives bare/claimed from team_member_id', () => {
    const rows: NameRow[] = [
      { id: 1, label: 'Zeta', team_member_id: null },
      { id: 2, label: 'Anders', team_member_id: 5 }
    ];
    expect(toNames(rows)).toEqual([
      { id: 2, label: 'Anders', team_member_id: 5, status: 'claimed' },
      { id: 1, label: 'Zeta', team_member_id: null, status: 'bare' }
    ]);
  });
});

// The Roster page's Names section (#1355): self-service Claim, officer manage.

const NAMES: NameRow[] = [
  { id: 1, label: 'Bare Raider', team_member_id: null },
  { id: 2, label: 'Claimed Raider', team_member_id: 9 }
];

function namesHandlers(overrides: {
  rpc?: FakeHandlers['rpc'];
  role?: 'officer' | 'raider' | null;
} = {}): FakeHandlers {
  const base = seededHandlers();
  const person = (role: string) => ({
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [{ team_id: 1, team_member_id: 1, role, characters: [] }]
  });
  return seededHandlers({
    session: overrides.role === null ? undefined : fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') return { data: person(overrides.role ?? 'raider') };
      if (overrides.rpc) return overrides.rpc(name, args);
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'names') return { data: NAMES };
      return base.from!(read);
    }
  });
}

describe('the Names section on the Roster page', () => {
  it('offers Claim on a bare Name to a signed-in raider, and calls claim_name', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        rpc(name, args) {
          if (name === 'claim_name') {
            seen.push(args);
            return { data: null };
          }
          return seededHandlers().rpc!(name, args);
        }
      })
    );
    await screen.findByText('Bare Raider');
    const bareRow = screen.getByText('Bare Raider').closest('li')!;
    await user.click(within(bareRow).getByRole('button', { name: 'Claim' }));
    expect(await screen.findByText('Claimed Bare Raider.')).toBeInTheDocument();
    expect(seen[0]).toEqual({ p_team_id: 1, p_name_id: 1 });
    expect(client.rpcs.some(([n]) => n === 'claim_name')).toBe(true);
  });

  it('does not offer Claim to a signed-out visitor', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: null }));
    await screen.findByText('Bare Raider');
    const bareRow = screen.getByText('Bare Raider').closest('li')!;
    expect(within(bareRow).queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
  });

  it('shows officer-only actions to an officer, not a raider', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await screen.findByText('Claimed Raider');
    expect(screen.getByRole('button', { name: 'Add Name' })).toBeInTheDocument();
    const claimedRow = screen.getByText('Claimed Raider').closest('li')!;
    expect(within(claimedRow).getByRole('button', { name: 'Remove claim' })).toBeInTheDocument();
    expect(within(claimedRow).getByRole('button', { name: 'Delete Member' })).toBeInTheDocument();
  });

  it('deletes a member after confirming, via delete_team_member', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        rpc(name, args) {
          if (name === 'delete_team_member') {
            seen.push(args);
            return { data: null };
          }
          return seededHandlers().rpc!(name, args);
        }
      })
    );
    await screen.findByText('Claimed Raider');
    const claimedRow = screen.getByText('Claimed Raider').closest('li')!;
    await user.click(within(claimedRow).getByRole('button', { name: 'Delete Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Claimed Raider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete Member' }));
    expect(await screen.findByText('Claimed Raider removed from the team.')).toBeInTheDocument();
    expect(seen[0]).toEqual({ p_team_id: 1, p_team_member_id: 9 });
  });

  it('a raider sees no officer actions and no Add Name form', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider' }));
    await screen.findByText('Claimed Raider');
    expect(screen.queryByRole('button', { name: 'Add Name' })).not.toBeInTheDocument();
    const claimedRow = screen.getByText('Claimed Raider').closest('li')!;
    expect(within(claimedRow).queryByRole('button', { name: 'Remove claim' })).not.toBeInTheDocument();
    expect(within(claimedRow).queryByRole('button', { name: 'Delete Member' })).not.toBeInTheDocument();
  });
});
