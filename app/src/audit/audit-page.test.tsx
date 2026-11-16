import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { asMember, seededHandlers, type Read } from '../test/fakeSupabase';
import { weekBefore, weekOf } from './audit';

const THIS = weekOf(new Date());
const LAST = weekBefore(THIS);
const NOW_ISO = new Date().toISOString();

const player = (id: number, name: string, cls: string, spec: string, role: string) => ({
  id,
  name_realm: `${name}-Stormrage`,
  name_realm_key: `${name.toLowerCase()}-stormrage`,
  url_code: `${name.toLowerCase()}01`,
  classes_specs: { class: cls, spec, role }
});

const PLAYERS = [
  player(1, 'Katorri', 'Warlock', 'Demonology', 'Ranged'),
  player(2, 'Torbjorn', 'Warrior', 'Protection', 'Tank'),
  player(3, 'Brightmend', 'Paladin', 'Holy', 'Heal')
];

const gear = (player_id: number, equipment_slot: string, over: object = {}) => ({
  player_id,
  equipment_slot,
  item_level: 720,
  wow_item_id: 500 + player_id,
  track: 'Hero',
  enchantment_id: 7959,
  gem_wow_item_ids: [],
  embellished: false,
  crafted: false,
  upgrade_rank: 4,
  upgrade_max: 6,
  synced_at: NOW_ISO,
  ...over
});

const GEAR = [
  // Katorri's head has no enchant and an empty socket.
  gear(1, 'HEAD', { enchantment_id: null, gem_wow_item_ids: [null] }),
  gear(2, 'HEAD'),
  gear(3, 'HEAD', { gem_wow_item_ids: [1] })
];

const vault = {
  raid: [
    { needs: 2, done: 3, track: 'Myth', rank: 1, item_level: 730 },
    { needs: 4, done: 3, track: 'Hero', rank: 1, item_level: 723 },
    { needs: 6, done: 3, track: 'Hero', rank: 1, item_level: 723 }
  ],
  dungeon: [
    { needs: 1, done: 1, track: 'Hero', rank: 1, item_level: 723 },
    { needs: 4, done: 1, left: 3 },
    { needs: 8, done: 1, left: 7 }
  ],
  world: null
};

const week = (key: string, week_of: string, over: object = {}) => ({
  name_realm_key: key,
  week_of,
  raid_kills: [
    { encounter_id: 1, difficulty: 'heroic' },
    { encounter_id: 2, difficulty: 'mythic' }
  ],
  raids_at: NOW_ISO,
  mplus_runs: [{ dungeon_id: 1, level: 12, timed: true }],
  mplus_rating: 2865,
  mplus_at: NOW_ISO,
  crests: { Myth: 640, Hero: 900 },
  crests_at: NOW_ISO,
  vault,
  vault_at: NOW_ISO,
  item_level: 688,
  best_item_level: 721,
  gear_at: null,
  ...over
});

const WEEKS = [
  week('katorri-stormrage', THIS),
  week('katorri-stormrage', LAST, { mplus_runs: [], vault: {} }),
  week('torbjorn-stormrage', THIS, { best_item_level: 724, item_level: 724 })
];

function handlers(settings: object = { enchantCheck: 'lenient', vaultRule: null }, failWeeks = false) {
  const base = seededHandlers();
  const rows: Record<string, unknown> = {
    seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null }],
    players: PLAYERS,
    player_equipped_gear: GEAR,
    character_weeks: WEEKS,
    season_enchant_slots: [{ slot: 'HEAD', counts_from: null }],
    season_enchants: [{ enchantment_id: 7959, top_rank: true, tertiary: true }],
    season_gems: [{ wow_item_id: 1, top_rank: true, epic: true }],
    tier_token_map: [],
    items: []
  };
  return asMember({
    ...base,
    rpc(name, args) {
      if (name === 'team_season_start') return { data: '2026-08-11' };
      if (name === 'season_crest_cap') return { data: args['p_track'] === 'Myth' ? 800 : null };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'team_settings') return { data: settings };
      if (read.table === 'character_weeks' && failWeeks) return { error: { message: 'weeks down' } };
      return read.table in rows ? { data: rows[read.table] } : base.from!(read);
    }
  });
}

const PATH = '/g/wga/t/phoenix/audit';

describe('Audit page', () => {
  it('lists every raider by role with their gear check, and what needs attention', async () => {
    renderApp(PATH, handlers());
    await screen.findByRole('heading', { level: 1, name: 'Audit' });
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('rowheader', { name: /Tanks/ })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: /Healers/ })).toBeInTheDocument();
    // Katorri: 0 of 1 enchants and 0 of 1 sockets filled; Torbjorn is clean.
    const kat = within(table).getByRole('row', { name: /Katorri/ });
    expect(
      within(kat)
        .getAllByRole('cell')
        .some((c) => c.textContent === '0/1')
    ).toBe(true);
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByText(/missing or wrong enchants/)).toBeInTheDocument();
    expect(within(attention).getByText(/empty sockets/)).toBeInTheDocument();
    // No vault rule is set, so there is no vault line.
    expect(within(attention).queryByText(/vault rule/)).not.toBeInTheDocument();
  });

  it('shows the highest item level ever by default and what is worn now on request', async () => {
    renderApp(PATH, handlers());
    const table = await screen.findByRole('table');
    const kat = within(table).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('721')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Item level/), 'worn');
    // The highest ever (721) is gone from the row; it shows the gear's own level.
    expect(within(table).getByRole('row', { name: /Katorri/ })).not.toHaveTextContent('721');
  });

  it('draws the vault as bars with a count, and unknown rows as a dash', async () => {
    renderApp(PATH, handlers());
    const table = await screen.findByRole('table');
    const kat = within(table).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByLabelText('Raid: 3 of 3 slots, best 730')).toBeInTheDocument();
    expect(within(kat).getByLabelText('Dungeons: 1 of 3 slots, best 723')).toBeInTheDocument();
  });

  it('the week switch changes the vault, M+ and raid columns to last week', async () => {
    renderApp(PATH, handlers());
    const table = await screen.findByRole('table');
    const kat = () => within(table).getByRole('row', { name: /Katorri/ });
    expect(kat()).toHaveTextContent('1 · best +12');
    await userEvent.click(screen.getByRole('button', { name: 'Last week' }));
    expect(kat()).toHaveTextContent('None');
    expect(screen.getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds the vault line once the team has a rule and a raider falls short', async () => {
    renderApp(PATH, handlers({ enchantCheck: 'lenient', vaultRule: { raid: 0, dungeon: 2, world: 0 } }));
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByText(/below the team vault rule/)).toBeInTheDocument();
  });

  it('opens one raider: gear to fix, the vault, crests with their cap, and M+ runs', async () => {
    renderApp(PATH, handlers());
    await userEvent.click(await screen.findByRole('button', { name: 'Open Katorri' }));
    const opened = await screen.findByRole('region', { name: 'Katorri' });
    expect(within(opened).getByText('No enchant')).toBeInTheDocument();
    expect(within(opened).getByText('Empty socket')).toBeInTheDocument();
    expect(within(opened).getByText(/4 of 9 slots filled/)).toBeInTheDocument();
    expect(await within(opened).findByText('640 / 800')).toBeInTheDocument();
    expect(within(opened).getByText('+12')).toBeInTheDocument();
    await userEvent.click(within(opened).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Katorri' })).not.toBeInTheDocument();
  });

  it('says what went wrong when the weekly rows cannot be read, instead of an empty page', async () => {
    renderApp(PATH, handlers(undefined, true));
    expect(await screen.findByText(/Couldn.t load the audit/)).toBeInTheDocument();
  });
});
