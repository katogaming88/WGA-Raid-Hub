import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import type { CatalogItem } from '../profile/lootPriority';
import type { PlayerRow } from '../roster/roster';
import {
  bossOptions,
  exportString,
  gearStatus,
  priorityItems,
  rankedRows,
  sections,
  splitNameRealm,
  tierPiecesEquipped,
  type PriorityData
} from './priority';

// Loot priority (#1362 part 1), from a fixture season: two Back pieces, a
// neck, a ring saved with nobody on it, and a tier piece and an older raid's
// item that must stay off the list.

const item = (id: number, name: string, slot: string, zone = 100, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name,
  slot,
  wcl_zone_id: zone,
  is_placeholder: false,
  source: 'raid',
  seasons: [],
  ...extra
});

const CATALOG = [
  item(1, 'Silken Voodoo Drape', 'Back'),
  item(2, 'Drape of the Dreadful Rite', 'Back'),
  item(3, 'Amulet of the Twin Fangs', 'Neck'),
  item(4, "Vile Alchemist's Band", 'Finger'),
  item(6, 'Voidwoven Mantle', 'Shoulder'),
  item(7, 'Old Raid Cloak', 'Back', 200),
  item(8, 'M+', 'Placeholder', 100, { is_placeholder: true })
];
const ZONES = [
  { wcl_zone_id: 100, season: 'MID2' },
  { wcl_zone_id: 200, season: 'MID1' }
];

const player = (
  id: number,
  nameRealm: string,
  klass: string,
  spec: string,
  role: string,
  nickname: string | null = null
) =>
  ({
    id,
    name_realm: nameRealm,
    nickname,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: klass, spec, role }
  }) satisfies PlayerRow;

const PLAYERS = [
  player(10, 'Katorrí-Stormrage', 'Warlock', 'Demonology', 'Ranged'),
  player(11, 'Bbldrizzy-Nazjatar', 'Druid', 'Restoration', 'Heal'),
  player(12, 'Angryamazon-Wyrmrest Accord', 'Hunter', 'Marksmanship', 'Ranged', 'Amazon')
];

const order = (item_id: number, track: string, rank: number, player_id: number, name_realm: string) => ({
  item_id,
  track,
  rank,
  player_id,
  players: { name_realm }
});

const DATA: PriorityData = {
  order: [
    // Stored out of rank order on purpose.
    order(1, 'Hero', 2, 11, 'Bbldrizzy-Nazjatar'),
    order(1, 'Hero', 1, 10, 'Katorrí-Stormrage'),
    order(1, 'Hero', 3, 99, 'Gone-Stormrage'),
    order(1, 'Myth', 1, 11, 'Bbldrizzy-Nazjatar'),
    order(3, 'Hero', 1, 12, 'Angryamazon-Wyrmrest Accord'),
    order(6, 'Hero', 1, 10, 'Katorrí-Stormrage'),
    order(7, 'Hero', 1, 10, 'Katorrí-Stormrage')
  ],
  empty: [{ item_id: 4, track: 'Hero' }],
  prefs: [
    { player_id: 10, item_id: 1, status: 'bis' },
    { player_id: 11, item_id: 1, status: 'pass' },
    { player_id: 11, item_id: 1, status: 'ok' }
  ],
  loot: [
    // Katorrí already won the drape on Heroic; Bbldrizzy won the other Back.
    { player_id: 10, item_id: 1, track: 'Hero', response: 'BiS' },
    { player_id: 11, item_id: 2, track: 'Hero', response: 'Upgrade' },
    // An off-spec roll is not an award for the main spec.
    { player_id: 12, item_id: 2, track: 'Hero', response: 'OS' }
  ],
  bosses: [
    { item_id: 1, boss: 'The Coiled Altar' },
    { item_id: 3, boss: 'The Twin Fangs' },
    { item_id: 4, boss: 'Vashnik the Malignant' }
  ],
  tierPieces: [{ class: 'Warlock', resolved_item_id: 6, resolved: { wow_item_id: 5006, slot: 'Shoulder' } }]
};

describe('priority list', () => {
  const items = priorityItems(DATA, 'Hero', CATALOG, ZONES, 'MID2');

  it("lists the season's items on the track, ranked first to last, and leaves out tier pieces and other raids", () => {
    expect(items.map((i) => i.name).sort()).toEqual([
      'Amulet of the Twin Fangs',
      'Silken Voodoo Drape',
      "Vile Alchemist's Band"
    ]);
    expect(items.find((i) => i.itemId === 1)!.ranked).toEqual([10, 11, 99]);
    expect(items.find((i) => i.itemId === 4)!.ranked).toEqual([]);
    expect(priorityItems(DATA, 'Myth', CATALOG, ZONES, 'MID2').map((i) => i.itemId)).toEqual([1]);
  });

  it('groups by slot in the current order and filters by name, boss and empty', () => {
    const all = { search: '', boss: '', hideEmpty: false };
    expect(sections(items, all).map((s) => s.label)).toEqual(['Back', 'Jewelry']);
    expect(sections(items, { ...all, search: 'AMULET' })[0]!.items.map((i) => i.itemId)).toEqual([3]);
    expect(sections(items, { ...all, boss: 'The Coiled Altar' }).flatMap((s) => s.items.map((i) => i.itemId))).toEqual([
      1
    ]);
    expect(sections(items, { ...all, hideEmpty: true }).flatMap((s) => s.items.map((i) => i.itemId))).toEqual([1, 3]);
  });

  it('orders the bosses by kill order, then any the setting does not list', () => {
    const raids = [{ name: 'Raid', bosses: [{ name: 'The Twin Fangs' }, { name: 'The Coiled Altar' }] }];
    expect(bossOptions(items, raids)).toEqual(['The Twin Fangs', 'The Coiled Altar', 'Vashnik the Malignant']);
  });

  it("flags each raider's mark, a win of this item, another win for the slot, and a raider who left", () => {
    const rows = rankedRows(
      items.find((i) => i.itemId === 1)!,
      'Hero',
      DATA,
      PLAYERS,
      CATALOG
    );
    expect(rows.map((r) => [r.rank, r.name, r.mark, r.received, r.sameSlot, r.left])).toEqual([
      [1, 'Katorrí', 'bis', true, [], false],
      [2, 'Bbldrizzy', 'ok', false, ['Drape of the Dreadful Rite'], false],
      [3, 'Gone', null, false, [], true]
    ]);
    // On Mythic, a Heroic win is not this track's.
    const myth = priorityItems(DATA, 'Myth', CATALOG, ZONES, 'MID2')[0]!;
    expect(
      rankedRows(myth, 'Myth', { ...DATA, loot: [{ ...DATA.loot[0]!, player_id: 11 }] }, PLAYERS, CATALOG)[0]!.received
    ).toBe(false);
  });

  it('flags a ring only once both are filled', () => {
    const ring = { itemId: 4, name: "Vile Alchemist's Band", slot: 'Finger', boss: null, ranked: [10] };
    const ringCatalog = [...CATALOG, item(20, 'Band A', 'Finger'), item(21, 'Band B', 'Finger')];
    const one = { ...DATA, loot: [{ player_id: 10, item_id: 20, track: 'Hero', response: null }] };
    expect(rankedRows(ring, 'Hero', one, PLAYERS, ringCatalog)[0]!.sameSlot).toEqual([]);
    const two = { ...DATA, loot: [...one.loot, { player_id: 10, item_id: 21, track: 'Myth', response: null }] };
    expect(rankedRows(ring, 'Hero', two, PLAYERS, ringCatalog)[0]!.sameSlot).toEqual(['Band A', 'Band B']);
  });
});

describe('export string', () => {
  it("is the payload's UTF-8 JSON in base64, as the current site makes it", () => {
    const payload = {
      players: { 'Katorrí-Stormrage': { class: 'WARLOCK' } },
      priority: { '12345': { H: ['Katorrí-Stormrage'] } }
    };
    expect(exportString(payload)).toBe(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'));
  });
});

describe('gear reads', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  it('says when the morning read last ran, and warns when it is old or failed', () => {
    expect(gearStatus(null, null, now)).toEqual({ text: 'No morning read recorded yet.', warn: true });
    const cron = { finished_at: '2026-10-18T06:00:00Z', synced: 76, skipped: 1, players: 77 };
    expect(gearStatus(cron, null, now).warn).toBe(false);
    expect(gearStatus(cron, null, now).text).toContain('76 raiders updated, 1 could not be read.');
    expect(gearStatus({ ...cron, finished_at: '2026-10-16T06:00:00Z' }, null, now).text).toContain(
      'has not run in 36 hours'
    );
    expect(gearStatus({ ...cron, synced: 0 }, null, now)).toMatchObject({ warn: true });
  });

  it("counts the class's tier pieces the raider has on, by Raider.IO's slot names", () => {
    const pieces = [
      ...DATA.tierPieces,
      { class: 'Warlock', resolved_item_id: 30, resolved: { wow_item_id: 5030, slot: 'Head' } },
      { class: 'Druid', resolved_item_id: 31, resolved: { wow_item_id: 5031, slot: 'Head' } }
    ];
    expect(tierPiecesEquipped('Warlock', pieces, { shoulder: { item_id: 5006 }, head: { item_id: 5030 } })).toBe(2);
    expect(tierPiecesEquipped('Warlock', pieces, { head: { item_id: 5031 } })).toBe(0);
    expect(splitNameRealm('Zug-Azjol-Nerub')).toEqual({ name: 'Zug', realm: 'Azjol-Nerub' });
  });
});

// The page, for an officer (or a guild officer, who only views).
function handlers(tables: Record<string, unknown>, role = 'officer', extra: Parameters<typeof seededHandlers>[0] = {}) {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person')
        return {
          data: {
            site_admin: false,
            guild_officer: role === 'guild',
            boe_manager: false,
            teams: role === 'guild' ? [] : [{ team_id: 1, team_member_id: 1, role, characters: [] }]
          }
        };
      if (name === 'team_season_start') return { data: null };
      if (name === 'build_rclc_export') return { data: PAYLOAD };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table in tables) return { data: tables[read.table] };
      return base.from!(read);
    },
    ...extra
  });
}

const PAYLOAD = { players: { 'Katorrí-Stormrage': { class: 'WARLOCK' } }, priority: {} };

const TABLES = {
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: null }],
  team_settings: {
    view: null,
    raidProgression: [{ name: 'Raid', bosses: [{ name: 'The Twin Fangs' }, { name: 'The Coiled Altar' }] }]
  },
  team_seasons: [],
  items: CATALOG.map(({ seasons, ...i }) => ({ ...i, item_seasons: (seasons ?? []).map((season) => ({ season })) })),
  raid_zones: ZONES,
  players: PLAYERS,
  priority_order: DATA.order,
  priority_order_confirmed_empty: DATA.empty,
  item_preferences: DATA.prefs,
  rclc_loot: DATA.loot,
  item_bosses: DATA.bosses,
  tier_token_map: DATA.tierPieces,
  site_settings: {
    gear_sync_last_cron_run: { finished_at: new Date().toISOString(), synced: 76, skipped: 0, players: 76 }
  }
};

const PAGE = '/g/wga/t/phoenix/officer/priority';

afterEach(() => vi.unstubAllGlobals());

describe('Loot priority page', () => {
  it('lists the items and opens one to show its order and flags', async () => {
    const { router } = renderApp(PAGE, handlers(TABLES));
    expect(await screen.findByRole('heading', { name: 'Pick an item to see its priority order' })).toBeInTheDocument();
    expect(screen.getByText(/Heroic track\. 3 items, 2 with someone ranked\./)).toBeInTheDocument();
    expect(screen.getByText('Midnight Season 2')).toBeInTheDocument();

    const list = screen.getByRole('navigation', { name: 'Items' });
    expect(within(list).getByRole('button', { name: "Vile Alchemist's Band, Nobody ranked" })).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Silken Voodoo Drape, #1 Katorrí · 3' }));

    const ranks = screen.getByRole('list', { name: 'Silken Voodoo Drape, Heroic order' });
    const rows = within(ranks).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Katorrí');
    expect(rows[0]).toHaveTextContent('BiS');
    expect(rows[0]).toHaveTextContent('Received Heroic');
    expect(rows[1]).toHaveTextContent('Sidegrade');
    expect(rows[1]).toHaveTextContent('Already has Back (Drape of the Dreadful Rite)');
    expect(rows[2]).toHaveTextContent('Left the roster');
    expect(router.state.location.search).toBe('?item=1');
  });

  it('makes the string for the track on screen, and drops it when the track changes', async () => {
    const { client } = renderApp(`${PAGE}?item=1`, handlers(TABLES));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Heroic string' }));
    expect(await screen.findByLabelText('RCLootCouncil string, Heroic')).toHaveValue(exportString(PAYLOAD));
    expect(client.rpcs).toContainEqual(['build_rclc_export', { p_team_id: 1, p_season: 'MID2', p_track: 'Hero' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Mythic' }));
    expect(screen.queryByLabelText(/RCLootCouncil string/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Mythic string' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Silken Voodoo Drape, Mythic order' })).toHaveTextContent('Bbldrizzy');
  });

  it('refreshes equipped gear for the team and says how it went', async () => {
    const invoke = vi.fn(() => ({ data: { success: true, synced: 24, skipped: 1 } }));
    const { client } = renderApp(PAGE, handlers(TABLES, 'officer', { invoke }));
    expect(await screen.findByText(/Last morning read: just now, 76 raiders updated\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh equipped gear' }));
    expect(await screen.findByText('24 raiders updated, 1 could not be read.')).toBeInTheDocument();
    expect(client.authCalls).toContainEqual(['invoke', ['blizzard-gear-sync', { body: { teamId: 1 } }]]);
  });

  it("syncs tier counts from Raider.IO, and refuses when the season's tier tokens are missing", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve({
        ok: !url.includes('Bbldrizzy'),
        json: () => Promise.resolve({ gear: { items: { shoulder: { item_id: 5006 } } } })
      })
    );
    vi.stubGlobal('fetch', fetch);
    const { client } = renderApp(PAGE, handlers(TABLES));
    await userEvent.click(await screen.findByRole('button', { name: 'Sync tier counts' }));
    expect(
      await screen.findByText('2 synced, 1 skipped (no Raider.IO data).', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(fetch.mock.calls.map((c) => c[0]).find((u) => u.includes('raider.io'))).toContain(
      'realm=stormrage&name=Katorr%C3%AD'
    );
    const writes = client.writes.filter((w) => w.table === 'players');
    expect(writes[0]).toMatchObject({
      method: 'update',
      values: { tier_pieces_equipped: 1 },
      filters: [['eq', 'id', 10]]
    });
    expect(writes[1]).toMatchObject({ values: { tier_pieces_equipped: 0 }, filters: [['eq', 'id', 12]] });
  });

  it('refuses a tier sync with no tier tokens set up', async () => {
    renderApp(PAGE, handlers({ ...TABLES, tier_token_map: [] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sync tier counts' }));
    expect(
      await screen.findByText('Not synced: no tier tokens are set up for Midnight Season 2 yet.')
    ).toBeInTheDocument();
  });

  it('shows a guild officer the lists and the export, not the gear buttons', async () => {
    renderApp(PAGE, handlers(TABLES, 'guild'));
    expect(await screen.findByRole('button', { name: 'Generate Heroic string' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh equipped gear' })).not.toBeInTheDocument();
  });
});
