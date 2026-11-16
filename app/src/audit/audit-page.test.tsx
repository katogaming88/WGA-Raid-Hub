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
    { encounter_id: 2888, difficulty: 'heroic' },
    { encounter_id: 2874, difficulty: 'mythic' }
  ],
  raids_at: NOW_ISO,
  mplus_runs: [{ dungeon_id: 525, level: 12, timed: true }],
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
    season_enchants: [{ enchantment_id: 7959, name: 'Hex of Leeching', top_rank: true, tertiary: true }],
    season_gems: [{ wow_item_id: 1, name: 'Eversong Diamond', top_rank: true, epic: true }],
    tier_token_map: [],
    items: [],
    season_raid_bosses: [
      { instance_id: 1320, encounter_id: 2888, name: 'Nek’zali the Soulcoiler', sort_order: 1 },
      { instance_id: 1320, encounter_id: 2874, name: 'Entombed Sentinels', sort_order: 2 }
    ],
    mplus_dungeons: [{ dungeon_id: 525, name: 'Operation: Floodgate' }]
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

  it('has Gear, Upgrades and Enchants & gems tabs, each at its own address', async () => {
    renderApp(PATH, handlers());
    const tabs = await screen.findByRole('navigation', { name: 'Audit views' });
    expect(within(tabs).getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(tabs).getByRole('link', { name: 'Gear' }));
    const region = await screen.findByRole('region', { name: 'Equipped gear by slot' });
    // Katorri's head has no enchant and an empty socket: both marked.
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('No enchant')).toBeInTheDocument();
    expect(within(kat).getByText('Empty socket')).toBeInTheDocument();
    expect(within(tabs).getByRole('link', { name: 'Gear' })).toHaveAttribute('aria-current', 'page');
  });

  it('Enchants & gems shows the team rule above enchant names, None and gem chips', async () => {
    renderApp(`${PATH}/enchants`, handlers());
    const region = await screen.findByRole('region', { name: 'Enchants and gems by slot' });
    expect(screen.getByText(/Team rule:/)).toHaveTextContent(/Lenient/);
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(kat.querySelector('.enchant-none')).toHaveTextContent('None');
    expect(within(kat).getByText('Empty')).toBeInTheDocument();
    const torb = within(region).getByRole('row', { name: /Torbjorn/ });
    expect(within(torb).getAllByText('Hex of Leeching').length).toBeGreaterThan(0);
  });

  it('Upgrades shows each slot out of its track and the steps left', async () => {
    renderApp(`${PATH}/upgrades`, handlers());
    const region = await screen.findByRole('region', { name: 'Upgrade steps by slot' });
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getAllByText('4/6').length).toBeGreaterThan(0);
  });

  it('Great Vault shows each slot with its item level, what is left, and the filled count', async () => {
    renderApp(`${PATH}/vault`, handlers());
    const region = await screen.findByRole('region', { name: 'Great Vault slots' });
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('4 / 9')).toBeInTheDocument();
    expect(within(kat).getByText('730')).toBeInTheDocument();
    expect(within(kat).getAllByText(/more run/).length).toBeGreaterThan(0);
  });

  it('Raids shows the highest difficulty per boss and switches period', async () => {
    renderApp(`${PATH}/raids`, handlers());
    const region = await screen.findByRole('region', { name: 'Raid kills by boss' });
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('M')).toBeInTheDocument();
    expect(within(kat).getByText('H')).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: /Entombed Sentinels/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Last week' }));
    expect(screen.getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Whole season' }));
    expect(screen.getByRole('button', { name: 'Whole season' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Dungeons shows the rating, runs, best key and the best key per dungeon', async () => {
    renderApp(`${PATH}/dungeons`, handlers());
    const region = await screen.findByRole('region', { name: 'Mythic plus by dungeon' });
    expect(within(region).getByRole('columnheader', { name: /Operation: Floodgate/ })).toBeInTheDocument();
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('2,865')).toBeInTheDocument();
    expect(within(kat).getAllByText(/\+12/).length).toBeGreaterThan(0);
  });

  it('Crests shows each type against its cap, and Capped when full', async () => {
    renderApp(`${PATH}/crests`, handlers());
    const region = await screen.findByRole('region', { name: 'Crests earned' });
    expect(await within(region).findByText('cap 800')).toBeInTheDocument();
    const kat = within(region).getByRole('row', { name: /Katorri/ });
    expect(within(kat).getByText('640 / 800')).toBeInTheDocument();
    expect(within(kat).getAllByText('no cap').length).toBeGreaterThan(0);
  });
});
