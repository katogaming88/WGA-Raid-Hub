import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Write } from '../test/fakeSupabase';
import { searchReviews, seasonOf, sourceLabel, type ReviewRow } from './reviews';

const SEASONS = [
  { code: 'TWW3', display_name: 'The War Within Season 3', starts_at: '2025-08-05', ends_at: '2026-02-24' },
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-02-24', ends_at: null }
];

// Officer Loot: Reviews (#1363), ported from js/tabs/tab-requests.js.

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  id: 1,
  status: 'pending',
  track: 'Hero',
  source: 'Great Vault',
  note: null,
  officer_notes: null,
  slot: null,
  submitted_at: '2026-10-20T02:00:00Z',
  player_id: 5,
  players: { name_realm: 'Katorrí-Stormrage', classes_specs: { class: 'Warlock' } },
  items: { name: 'Voidbound Cinch', slot: 'Waist', wow_item_id: null, is_ptr: null, icon: null },
  ...over
});

describe('review rules', () => {
  it('files a request under the season current on the Eastern date it was sent', () => {
    expect(seasonOf(row({ submitted_at: '2026-02-24T04:59:00Z' }), SEASONS)).toBe('TWW3');
    expect(seasonOf(row({ submitted_at: '2026-02-24T05:00:00Z' }), SEASONS)).toBe('MID1');
    expect(seasonOf(row({}), [])).toBeNull();
  });

  it('names the source with its difficulty', () => {
    expect(sourceLabel({ track: 'Myth', source: 'Great Vault' })).toBe('Mythic: Great Vault');
    expect(sourceLabel({ track: null, source: 'Crafted' })).toBe('Crafted');
  });

  it('searches the raider, item, source and note', () => {
    const rows = [row({ id: 1 }), row({ id: 2, note: 'traded by Brakkus', items: null })];
    expect(searchReviews(rows, 'brakkus').map((r) => r.id)).toEqual([2]);
    expect(searchReviews(rows, 'mythic')).toEqual([]);
    expect(searchReviews(rows, 'heroic')).toHaveLength(2);
  });
});

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

function handlers(
  rows: ReviewRow[],
  who = person('officer'),
  writes: Write[] = [],
  seasons: unknown[] = []
): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Aur#1', discord: { id: 'd', name: 'Aur' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: who };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'self_received_requests') return { data: rows };
      if (read.table === 'seasons') return { data: seasons };
      return base.from!(read);
    },
    write(w) {
      writes.push(w);
      return { data: null };
    }
  });
}

const PATH = '/g/wga/t/phoenix/officer/reviews';

describe('Reviews page', () => {
  it('approves a waiting item, logs it and tells the raider', async () => {
    const writes: Write[] = [];
    const { client } = renderApp(PATH, handlers([row({ note: 'From the vault' })], person('officer'), writes));
    expect(await screen.findByText('“From the vault”')).toBeInTheDocument();
    expect(screen.getByText('Heroic: Great Vault')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findAllByText("Approved Katorrí's Voidbound Cinch. It counts as received.")).not.toHaveLength(
      0
    );
    expect(writes[0]).toMatchObject({
      table: 'self_received_requests',
      method: 'update',
      values: { status: 'approved' }
    });
    expect(client.rpcs).toContainEqual([
      'write_audit_log',
      {
        p_team_id: 1,
        p_action: 'Self-Received Approved',
        p_target_type: 'players',
        p_target_id: 5,
        p_detail: 'Voidbound Cinch'
      }
    ]);
    expect(client.rpcs).toContainEqual([
      'notify_player',
      { p_player_id: 5, p_message: 'Your self-received item (Voidbound Cinch) was approved.' }
    ]);
  });

  it('rejects with a reason the raider sees', async () => {
    const writes: Write[] = [];
    const { client } = renderApp(PATH, handlers([row({})], person('officer'), writes));
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject Voidbound Cinch?' });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Not on your wishlist');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findAllByText("Rejected Katorrí's Voidbound Cinch.")).not.toHaveLength(0);
    expect(writes[0]?.values).toEqual({ status: 'rejected', officer_notes: 'Not on your wishlist' });
    expect(client.rpcs).toContainEqual([
      'notify_player',
      {
        p_player_id: 5,
        p_message: 'Your self-received item (Voidbound Cinch) was rejected. Reason: Not on your wishlist'
      }
    ]);
  });

  it('puts a decision back to waiting, or deletes it after asking', async () => {
    const writes: Write[] = [];
    const { client } = renderApp(
      PATH,
      handlers([row({ status: 'rejected', officer_notes: 'Duplicate' })], person('officer'), writes)
    );
    expect(await screen.findByText('Reason: Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting this season.')).toBeInTheDocument();
    const more = () => screen.getByRole('button', { name: "More actions for Katorrí's Voidbound Cinch" });
    await userEvent.click(more());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Back to waiting' }));
    expect(await screen.findAllByText("Katorrí's Voidbound Cinch is waiting for review again.")).not.toHaveLength(0);
    expect(writes[0]?.values).toEqual({ status: 'pending' });

    await userEvent.click(more());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this decision?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findAllByText("Deleted Katorrí's Voidbound Cinch.")).not.toHaveLength(0);
    expect(client.rpcs).toContainEqual(['delete_self_received_request', { p_id: 1 }]);
  });

  it('shows a guild officer from another team the list without buttons', async () => {
    renderApp(PATH, handlers([row({})], person(null, true)));
    expect(await screen.findByText('Voidbound Cinch')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows this season decisions, and an older season when picked', async () => {
    renderApp(
      PATH,
      handlers(
        [
          row({ id: 1, status: 'approved', submitted_at: '2026-10-01T02:00:00Z' }),
          row({
            id: 2,
            status: 'approved',
            submitted_at: '2025-12-01T02:00:00Z',
            player_id: 6,
            players: { name_realm: 'Oldtimer-Illidan', classes_specs: null },
            items: { name: 'Old Ring', slot: 'Finger', wow_item_id: null, is_ptr: null, icon: null }
          })
        ],
        person('officer'),
        [],
        SEASONS
      )
    );
    expect(await screen.findByText('Katorrí')).toBeInTheDocument();
    expect(screen.queryByText('Oldtimer')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Season'), 'TWW3');
    expect(screen.getByText('Oldtimer')).toBeInTheDocument();
    expect(screen.queryByText('Katorrí')).not.toBeInTheDocument();
  });
});
