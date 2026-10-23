import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Write } from '../test/fakeSupabase';
import { pickerName } from './ReassignPage';
import { parseMove } from './useReassign';

// Officer Loot: Reassign (#1363), ported from js/tabs/tab-loot-import.js.

const PLAYERS = [
  { id: 5, name_realm: 'Katorrí-Stormrage', nickname: 'Kat', classes_specs: { class: 'Warlock' } },
  { id: 6, name_realm: 'Brakkus-Illidan', nickname: null, classes_specs: { class: 'Warrior' } }
];

const LOOT = [
  {
    id: 11,
    track: 'Hero',
    season: 'MID1',
    awarded_at: '2026-10-01T02:00:00Z',
    items: { name: 'Voidbound Cinch', wow_item_id: null, is_ptr: null, icon: null }
  }
];

const person = (role: string | null, guildOfficer = false) => ({
  site_admin: false,
  guild_officer: guildOfficer,
  boe_manager: false,
  teams: role
    ? [
        {
          team_id: 1,
          team_member_id: 1,
          role,
          characters: [{ player_id: 1, name_realm: 'Aur-Illidan', url_code: null, archived_at: null }]
        }
      ]
    : []
});

function handlers(who = person('officer'), writes: Write[] = [], history: unknown[] = []): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Aur#1', discord: { id: 'd', name: 'Aur' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: who };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'players') return { data: PLAYERS };
      if (read.table === 'rclc_loot') return { data: LOOT };
      if (read.table === 'audit_log') return { data: history };
      if (read.table === 'items')
        return { data: [{ name: 'Voidbound Cinch', wow_item_id: 1234, is_ptr: false, icon: null }] };
      if (read.table === 'seasons') return { data: [{ code: 'MID1', display_name: 'Midnight Season 1' }] };
      return base.from!(read);
    },
    write(w) {
      writes.push(w);
      return { data: null };
    }
  });
}

const PATH = '/g/wga/t/phoenix/officer/reassign';

describe('Reassign page', () => {
  it('names a raider by nickname and character', () => {
    expect(pickerName(PLAYERS[0]!)).toBe('Kat (Katorrí)');
    expect(pickerName(PLAYERS[1]!)).toBe('Brakkus');
  });

  it('reads a move back from its audit entry', () => {
    expect(parseMove('Voidbound Cinch: Kat (Katorrí) -> Brakkus')).toEqual({
      item: 'Voidbound Cinch',
      from: 'Kat (Katorrí)',
      to: 'Brakkus'
    });
    expect(parseMove({ summary: 'x' })).toBeNull();
  });

  it('lists past reassignments, and says when there are none', async () => {
    const entry = {
      id: 1,
      actor_id: null,
      action: 'Loot Reassigned',
      target_type: 'players',
      target_id: 6,
      detail: 'Voidbound Cinch: Kat (Katorrí) -> Brakkus',
      created_at: '2026-10-02T02:00:00Z'
    };
    renderApp(PATH, handlers(person('officer'), [], [entry]));
    expect(await screen.findByText('1 so far, newest first.', { exact: false })).toBeInTheDocument();
    // The catalog's copy, so the item's tooltip shows.
    expect(screen.getByRole('link', { name: /Voidbound Cinch/ })).toHaveAttribute(
      'href',
      expect.stringContaining('1234')
    );
  });

  it('says when nothing has been reassigned', async () => {
    renderApp(PATH, handlers());
    expect(await screen.findByText('No loot reassigned yet.')).toBeInTheDocument();
  });

  it('moves an item to another raider and logs it', async () => {
    const writes: Write[] = [];
    const { client } = renderApp(PATH, handlers(person('officer'), writes));
    await userEvent.selectOptions(await screen.findByLabelText('Now credited to'), '5');
    expect(await screen.findByText('Heroic, Midnight Season 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign Voidbound Cinch?' });
    const confirm = within(dialog).getByRole('button', { name: 'Reassign' });
    expect(confirm).toBeDisabled();
    // The raider who has it now is not offered.
    expect(within(dialog).queryByRole('option', { name: 'Kat (Katorrí)' })).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Give it to'), '6');
    await userEvent.click(confirm);
    expect(await screen.findAllByText('Voidbound Cinch now counts for Brakkus.')).not.toHaveLength(0);
    expect(writes[0]).toMatchObject({ table: 'rclc_loot', method: 'update', values: { player_id: 6 } });
    expect(client.rpcs).toContainEqual([
      'write_audit_log',
      {
        p_team_id: 1,
        p_action: 'Loot Reassigned',
        p_target_type: 'players',
        p_target_id: 6,
        p_detail: 'Voidbound Cinch: Kat (Katorrí) -> Brakkus'
      }
    ]);
  });

  it('tells a guild officer from another team it is for the team officers', async () => {
    renderApp(PATH, handlers(person(null, true)));
    expect(await screen.findByText("Only this team's officers can reassign loot.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Now credited to')).not.toBeInTheDocument();
  });
});
