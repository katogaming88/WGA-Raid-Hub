import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { groupImports, importSeasons, importSummary, parseRclcPaste, UNKNOWN_SEASON } from './lootImport';

// Officer Loot: Import (#1363), ported from js/tabs/tab-loot-import.js.

describe('parseRclcPaste', () => {
  it('keeps the fields import_rclc_loot() reads, and drops entries it cannot match', () => {
    const paste = JSON.stringify([
      { id: ' 1 ', player: 'Katorri-Stormrage', instance: 'Raid-Heroic', itemID: 5, extra: 'x' },
      { id: '2', player: '', instance: 'Raid-Heroic' }
    ]);
    const parsed = parseRclcPaste(paste);
    expect(parsed).toEqual({
      rows: [
        {
          id: '1',
          player: 'Katorri-Stormrage',
          date: '',
          time: '',
          itemID: 5,
          itemName: '',
          itemString: '',
          instance: 'Raid-Heroic',
          boss: '',
          response: ''
        }
      ]
    });
  });

  it('says what is wrong with a paste it cannot use', () => {
    expect(parseRclcPaste('  ')).toEqual({ error: 'Paste the RCLootCouncil JSON export first.' });
    expect(parseRclcPaste('{not json')).toHaveProperty('error');
    expect(parseRclcPaste('{}')).toEqual({ error: 'Expected a list of awards, starting with [.' });
    expect(parseRclcPaste('[{"id":"1"}]')).toHaveProperty('error');
  });
});

describe('importSummary', () => {
  it('counts what was added, skipped and left without an item', () => {
    expect(importSummary({ inserted: 1 })).toBe('Imported 1 new award.');
    expect(importSummary({ inserted: 3, skipped_duplicate: 2, unresolved_item: 1 })).toBe(
      "Imported 3 new awards, skipped 2 already on file, 1 with an item the hub doesn't know."
    );
  });
});

describe('groupImports', () => {
  const row = (actor: string, at: string, target: number, detail: unknown) => ({
    actor_id: actor,
    target_type: 'players',
    target_id: target,
    detail,
    created_at: at
  });

  it('makes one entry per paste, newest first, with each raider items', () => {
    const events = groupImports([
      row('a', '2026-09-01T02:00:00Z', 5, { summary: 'Hero - Belt', season: 'MID1' }),
      row('a', '2026-09-01T02:00:00Z', 5, { summary: 'Hero - Ring', season: 'MID1' }),
      row('a', '2026-09-08T02:00:00Z', 6, 'Myth - Cloak')
    ]);
    expect(events.map((e) => [e.at, e.itemCount, e.season])).toEqual([
      ['2026-09-08T02:00:00Z', 1, UNKNOWN_SEASON],
      ['2026-09-01T02:00:00Z', 2, 'MID1']
    ]);
    expect(events[1]!.byPlayer.get(5)).toEqual(['Hero - Belt', 'Hero - Ring']);
    expect(importSeasons(events)).toEqual(['MID1', UNKNOWN_SEASON]);
  });
});

const OFFICER_PERSON = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role: 'officer',
      characters: [{ player_id: 1, name_realm: 'Aur-Illidan', url_code: null, archived_at: null }]
    }
  ]
};

const SEASONS = [{ code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: null }];

function handlers(person: unknown, tables: Record<string, unknown[]> = {}): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Aur#1', discord: { id: 'd', name: 'Aur' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: person };
      if (name === 'resolve_actor_name') return { data: 'Aurelith' };
      if (name === 'import_rclc_loot') return { data: { inserted: 2, skipped_duplicate: 1 } };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'seasons') return { data: SEASONS };
      if (read.table in tables) return { data: tables[read.table] };
      return base.from!(read);
    }
  });
}

describe('Import loot page', () => {
  it('sends the paste under the current season and says what it added', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/officer/import', handlers(OFFICER_PERSON));
    expect(await screen.findByText('Midnight Season 1')).toBeInTheDocument();
    const paste = [{ id: '1', player: 'Katorri-Stormrage', instance: 'Raid-Heroic' }];
    await userEvent.click(screen.getByLabelText('RCLootCouncil JSON'));
    await userEvent.paste(JSON.stringify(paste));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(
      await screen.findAllByText('Imported 2 new awards, skipped 1 already on file.', { exact: false })
    ).not.toHaveLength(0);
    const call = client.rpcs.find(([name]) => name === 'import_rclc_loot');
    expect(call?.[1]).toMatchObject({ p_team_id: 1, p_season: 'MID1', p_rows: [{ id: '1' }] });
  });

  it('shows a paste problem beside the box and sends nothing', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/officer/import', handlers(OFFICER_PERSON));
    await screen.findByText('Midnight Season 1');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Paste the RCLootCouncil JSON export first.')).toBeInTheDocument();
    expect(client.rpcs.some(([name]) => name === 'import_rclc_loot')).toBe(false);
  });

  it('lists past imports with who ran them and who got what', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/import',
      handlers(OFFICER_PERSON, {
        audit_log: [
          {
            id: 1,
            actor_id: 'actor-1',
            action: 'Loot Imported (RCLC)',
            target_type: 'players',
            target_id: 5,
            detail: { summary: 'Hero - Belt', season: 'MID1' },
            created_at: '2026-09-02T02:00:00Z'
          }
        ],
        players: [{ id: 5, name_realm: 'Torbjorn-Illidan' }]
      })
    );
    expect(await screen.findByText('Aurelith')).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.getByText('Torbjorn')).toBeInTheDocument();
    expect(screen.getByText('Hero - Belt')).toBeInTheDocument();
  });

  it('shows a guild officer the history but not the form', async () => {
    renderApp('/g/wga/t/phoenix/officer/import', handlers({ ...OFFICER_PERSON, guild_officer: true, teams: [] }));
    expect(await screen.findByText("Only this team's officers can import loot.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(await screen.findByText('No loot imported yet.')).toBeInTheDocument();
  });
});
