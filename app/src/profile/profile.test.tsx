import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, filterValue, seededHandlers, type Read } from '../test/fakeSupabase';
import { attendance, characterLinks, equippedGear, formatJoinDate, seasonCode, seasonLoot } from './profile';
import { lootPriority } from './lootPriority';
import { wishlistSummary } from './wishlist';

const SEASON = { name: 'Midnight Season 2', code: 'MID2', start: '2026-08-01', end: '2026-12-31' };

describe('attendance', () => {
  const rows = [
    { raid_date: '2026-07-20', status: 'No Show', report_excluded: false },
    { raid_date: '2026-08-05', status: 'Excused', report_excluded: false },
    { raid_date: '2026-08-12', status: 'Present', report_excluded: false },
    { raid_date: '2026-08-14', status: 'Late (no notice)', report_excluded: false },
    { raid_date: '2026-08-15', status: 'No Show', report_excluded: true },
    { raid_date: '2026-08-19', status: 'No Show', report_excluded: false },
    { raid_date: '2026-08-21', status: 'Present', report_excluded: false },
    { raid_date: '2026-08-26', status: 'Not on Roster', report_excluded: false },
    { raid_date: '2026-08-28', status: null, report_excluded: false }
  ];

  it('weights the nights from the join date and flags the season’s missed and late nights', () => {
    expect(attendance(rows, SEASON, '2026-08-10')).toEqual({
      pct: 62.5,
      flagged: [
        { date: '2026-08-19', status: 'No Show' },
        { date: '2026-08-14', status: 'Late (no notice)' },
        { date: '2026-08-05', status: 'Excused' }
      ]
    });
  });

  it('gives full credit before a first counted night', () => {
    expect(attendance([], SEASON, null).pct).toBe(100);
  });
});

describe('seasonLoot', () => {
  const award = (id: number, track: string, season: string, at: string) => ({
    id,
    track,
    season,
    awarded_at: at,
    items: { name: `Item ${id}` }
  });

  it('keeps the current season, newest first, with the last day’s awards together', () => {
    const loot = seasonLoot(
      [
        award(1, 'Myth', 'MID1', '2026-05-01T18:00:00Z'),
        award(2, 'Hero', 'MID2', '2026-08-20T18:00:00Z'),
        award(3, 'Myth', 'MID2', '2026-08-28T02:00:00Z'),
        award(4, 'Champion', 'MID2', '2026-08-27T23:30:00Z')
      ],
      SEASON
    );
    expect(loot.awards.map((a) => [a.name, a.difficulty, a.date])).toEqual([
      ['Item 3', 'Mythic', 'Aug 27, 2026'],
      ['Item 4', 'Normal', 'Aug 27, 2026'],
      ['Item 2', 'Heroic', 'Aug 20, 2026']
    ]);
    // 02:00 UTC on the 28th is raid night the 27th on Eastern time.
    expect(loot.last?.awards.map((a) => a.name)).toEqual(['Item 3', 'Item 4']);
  });
});

describe('header helpers', () => {
  it('builds character links from the realm as the sites spell it', () => {
    expect(characterLinks("Torbjorn-Kel'Thuzad")?.raiderIo).toBe('https://raider.io/characters/us/kelthuzad/Torbjorn');
    expect(characterLinks('Angryamazon-Area 52')?.armory).toBe(
      'https://worldofwarcraft.com/en-us/character/us/area-52/Angryamazon'
    );
  });

  it('writes the join date and season code the way the current site does', () => {
    expect(formatJoinDate('2026-08-10')).toBe('Aug 10, 2026');
    expect(seasonCode('Midnight Season 2')).toBe('MID2');
    expect(seasonCode('Something else')).toBeNull();
  });

  it('lists equipped gear in gear-panel order, naming unknown items by id', () => {
    const gear = equippedGear(
      [
        { equipment_slot: 'TRINKET_1', item_id: 2, item_level: 318, track: 'Hero' },
        { equipment_slot: 'HEAD', item_id: 1, item_level: 321, track: 'Myth' },
        { equipment_slot: 'NECK', item_id: 9, item_level: 300, track: null }
      ],
      new Map([
        [1, 'Helm'],
        [2, 'Trinket']
      ])
    );
    expect(gear.map((g) => [g.slot, g.item])).toEqual([
      ['Head', 'Helm'],
      ['Neck', 'Item #9'],
      ['Trinket 1', 'Trinket']
    ]);
  });
});

// The profile page against a fake database, signed in as `person`.
const TORBJORN = {
  id: 11,
  name_realm: 'Torbjorn-Illidan',
  nickname: 'Raz',
  url_code: 'tb000011',
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  is_backup_tank: true,
  is_backup_healer: false,
  m_plus_excluded: false,
  m_plus_note: null,
  join_date: '2026-08-10',
  tier_pieces_equipped: 4,
  classes_specs: { class: 'Death Knight', spec: 'Frost', role: 'Melee' }
};

const person = (role: string, playerId: number | null) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: playerId
        ? [{ player_id: playerId, name_realm: 'X-Illidan', url_code: 'tb000011', archived_at: null }]
        : []
    }
  ]
});

function profileHandlers(who: ReturnType<typeof person> | null, tables: Record<string, (read: Read) => unknown> = {}) {
  const base = seededHandlers();
  return seededHandlers({
    ...(who ? { session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }) } : {}),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: who ? 'discord-x' : null };
      if (name === 'resolve_person') return { data: who };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table in tables) return tables[read.table]!(read) as never;
      if (read.table === 'players' && read.single) return { data: TORBJORN };
      if (read.table === 'team_settings') {
        return { data: { name: SEASON.name, start: SEASON.start, end: SEASON.end } };
      }
      if (read.table === 'mplus_exclusion_requests') return { data: { officer_notes: 'Sockets missing' } };
      return base.from!(read);
    }
  });
}

describe('Profile page', () => {
  it('asks a visitor to sign in', async () => {
    renderApp('/g/wga/t/phoenix/me', profileHandlers(null));
    expect(await screen.findByText('Sign in to see your profile.')).toBeInTheDocument();
  });

  it('shows My profile for the raider’s own character', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/me', profileHandlers(person('raider', 11)));
    expect(await screen.findByRole('heading', { level: 1, name: 'Raz' })).toBeInTheDocument();
    expect(screen.getByText('Frost Death Knight')).toBeInTheDocument();
    expect(screen.getByText('Backup Tank')).toBeInTheDocument();
    expect(screen.getByText('Joined Aug 10, 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Raider.IO' })).toHaveAttribute(
      'href',
      'https://raider.io/characters/us/illidan/Torbjorn'
    );
    const read = client.reads.find((r) => r.table === 'players' && r.single)!;
    expect(read.filters).toContainEqual(['eq', 'id', 11]);
    // A raider reads their own M+ requests (20260914201423), and only theirs.
    const mplus = await waitFor(() => client.reads.find((r) => r.table === 'mplus_exclusion_requests')!);
    expect(mplus.filters).toContainEqual(['eq', 'player_id', 11]);
  });

  it('says so when the signed-in person has no character on the team', async () => {
    renderApp('/g/wga/t/phoenix/me', profileHandlers(person('raider', null)));
    expect(await screen.findByText('You don’t have a character on Phoenix yet.')).toBeInTheDocument();
  });

  it('keeps a raider out of someone else’s profile', async () => {
    renderApp('/g/wga/t/phoenix/p/someoneelse', profileHandlers(person('raider', 11)));
    expect(
      await screen.findByText('You can only open your own profile. Officers can open anyone’s.')
    ).toBeInTheDocument();
  });

  it('opens anyone’s profile for an officer, with a refused M+ request', async () => {
    renderApp('/g/wga/t/phoenix/p/tb000011', profileHandlers(person('officer', null)));
    expect(await screen.findByRole('heading', { level: 1, name: 'Raz' })).toBeInTheDocument();
    const mplus = screen.getByRole('heading', { name: 'M+ exclusion' }).closest('section')!;
    expect(await within(mplus).findByText('Rejected')).toBeInTheDocument();
    expect(within(mplus).getByText('Sockets missing')).toBeInTheDocument();
  });

  it('shows a failed read in its own card with a way to retry', async () => {
    renderApp(
      '/g/wga/t/phoenix/me/loot',
      profileHandlers(person('raider', 11), { rclc_loot: () => ({ error: { message: 'loot read failed' } }) })
    );
    const loot = (await screen.findByRole('heading', { name: 'Items received' })).closest('section')!;
    const alert = await within(loot).findByRole('alert');
    expect(alert).toHaveTextContent('loot read failed');
    // Found rather than got: the button waits for the earlier characters' read
    // (#942 step 5b), which loads beside the loot.
    expect(await within(alert).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Profile tabs', () => {
  it('give each section its own address and keep My profile current in the menu', async () => {
    const { router } = renderApp('/g/wga/t/phoenix/me', profileHandlers(person('raider', 11)));
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
    expect(screen.getByRole('heading', { name: 'Equipped gear' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Loot' }));
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix/me/loot');
    expect(await screen.findByRole('heading', { name: 'Items received' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Loot priority' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute('aria-current', 'page');
  });

  it('move with the arrow keys', async () => {
    const { router } = renderApp('/g/wga/t/phoenix/me/loot', profileHandlers(person('raider', 11)));
    const loot = await screen.findByRole('tab', { name: 'Loot' });
    loot.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix/me/wishlist');
    expect(screen.getByRole('tab', { name: 'Wishlist' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix/me');
  });

  it('open an officer view at the tab in its address, and send an unknown tab to the Overview', async () => {
    const { router } = renderApp('/g/wga/t/phoenix/p/tb000011/wishlist', profileHandlers(person('officer', null)));
    expect(await screen.findByRole('tab', { name: 'Wishlist' })).toHaveAttribute('aria-selected', 'true');
    await router.navigate('/g/wga/t/phoenix/p/tb000011/nope');
    await waitFor(() => expect(router.state.location.pathname).toBe('/g/wga/t/phoenix/p/tb000011'));
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });
});

describe('Roster names', () => {
  const rosterTables = {
    players: (read: Read) =>
      read.single
        ? { data: TORBJORN }
        : {
            data: [
              { ...TORBJORN, url_code: 'tb000011' },
              { ...TORBJORN, id: 12, name_realm: 'Dodgey-Illidan', nickname: null, url_code: 'dg000012' }
            ]
          }
  };

  it('link to a raider’s own profile only', async () => {
    renderApp('/g/wga/t/phoenix/roster', profileHandlers(person('raider', 11), rosterTables));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    expect(await within(table).findByRole('link', { name: 'Raz' })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/p/tb000011'
    );
    expect(within(table).queryByRole('link', { name: 'Dodgey' })).not.toBeInTheDocument();
  });

  it('link to every profile for an officer', async () => {
    renderApp('/g/wga/t/phoenix/roster', profileHandlers(person('officer', null), rosterTables));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    expect(await within(table).findByRole('link', { name: 'Dodgey' })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/p/dg000012'
    );
  });
});

describe('lootPriority', () => {
  const season = SEASON;
  const catalog = [
    { id: 1, name: 'Venomforged Idol', slot: 'Hands', wcl_zone_id: 53, is_placeholder: false },
    { id: 2, name: 'Band of the Hollow Choir', slot: 'Finger', wcl_zone_id: 53, is_placeholder: false },
    { id: 3, name: 'Crafted', slot: 'Placeholder', wcl_zone_id: null, is_placeholder: true },
    { id: 4, name: 'Old Tier Cloak', slot: 'Back', wcl_zone_id: 46, is_placeholder: false },
    { id: 5, name: 'Caustic Sash', slot: 'Waist', wcl_zone_id: 53, is_placeholder: false }
  ];
  const zones = [
    { wcl_zone_id: 53, season: 'MID2' },
    { wcl_zone_id: 46, season: 'MID1' }
  ];
  const pick = (item_id: number, slot: string, status = 'bis') => ({ item_id, status, slot, season: SEASON.name });
  const base = {
    playerId: 11,
    catalog,
    zones,
    season,
    ranks: [
      { item_id: 1, track: 'Hero', rank: 1, player_id: 12 },
      { item_id: 1, track: 'Hero', rank: 2, player_id: 11 },
      { item_id: 1, track: 'Myth', rank: 1, player_id: 11 }
    ],
    tierTokens: [{ token_item_id: 1, resolved: { name: 'Grave-Knight Deathgrips' } }],
    loot: [{ track: 'Hero', awarded_at: '2026-08-20T18:00:00Z', items: { name: 'Caustic Sash' } }],
    selfReceived: [
      { track: 'Myth', source: 'Great Vault', slot: null, items: { name: 'Caustic Sash' } },
      { track: 'Hero', source: 'Crafted', slot: 'Wrist', items: { name: 'Crafted' } }
    ]
  };

  it('lists this season’s BiS picks in slot order, once per ring, with standings and receipts', () => {
    const rows = lootPriority({
      ...base,
      wishlist: [
        pick(2, 'Finger 1'),
        pick(2, 'Finger 2'),
        pick(1, 'Hands'),
        pick(3, 'Wrist'),
        pick(4, 'Back'),
        pick(5, 'Waist'),
        pick(5, 'Feet', 'good')
      ]
    });
    expect(rows.map((r) => [r.slot, r.item, r.ranks, r.received])).toEqual([
      ['Wrist', 'Crafted', [], { track: 'Heroic', detail: 'Crafted' }],
      [
        'Hands',
        'Grave-Knight Deathgrips',
        [
          { track: 'Heroic', rank: 2, of: 2 },
          { track: 'Mythic', rank: 1, of: 1 }
        ],
        null
      ],
      // A Mythic Great Vault copy beats the Heroic raid drop.
      ['Waist', 'Caustic Sash', [], { track: 'Mythic', detail: 'Great Vault' }],
      ['Finger', 'Band of the Hollow Choir', [], null]
    ]);
  });

  it('counts a raid item receipt saved with its catalog slot, as most live ones are', () => {
    const [row] = lootPriority({
      ...base,
      loot: [],
      wishlist: [pick(2, 'Finger 1')],
      selfReceived: [
        { track: 'Myth', source: 'Bonus Roll', slot: 'Finger', items: { name: 'Band of the Hollow Choir' } }
      ]
    });
    expect(row!.received).toEqual({ track: 'Mythic', detail: 'Bonus Roll' });
    // The report names the catalog item, not the class piece a token shows as.
    const [token] = lootPriority({ ...base, wishlist: [pick(1, 'Hands')] });
    expect([token!.item, token!.itemName]).toEqual(['Grave-Knight Deathgrips', 'Venomforged Idol']);
  });

  it('counts the wishlist’s slots with a BiS pick and the ones passed', () => {
    expect(
      wishlistSummary(
        [pick(2, 'Finger 1'), pick(1, 'Hands'), pick(5, 'Waist', 'pass'), pick(4, 'Back'), pick(5, 'Hands', 'pass')],
        catalog,
        zones,
        season
      )
      // The ring fills Finger 1 only (#1032: two picks for paired slots).
    ).toEqual({ bis: 2, pass: 1, total: 16 });
  });

  it('counts a pick saved without a slot by its item, a ring in the first ring slot', () => {
    const legacy = (item_id: number, status = 'bis') => ({ item_id, status, slot: null, season: SEASON.name });
    expect(wishlistSummary([legacy(2), legacy(1), legacy(5, 'pass')], catalog, zones, season)).toEqual({
      bis: 2,
      pass: 1,
      total: 16
    });
  });

  it('does not count the current site’s copy of a ring BiS, and counts a ring Pass in both slots', () => {
    const copy = { ...pick(2, 'Finger 2'), synced_bis: true };
    expect(wishlistSummary([pick(2, 'Finger 1'), copy], catalog, zones, season)).toEqual({
      bis: 1,
      pass: 0,
      total: 16
    });
    expect(wishlistSummary([pick(2, 'Finger 2', 'pass')], catalog, zones, season)).toEqual({
      bis: 0,
      pass: 2,
      total: 16
    });
  });
});

// Characters and alts (#942 step 5b).
describe('Characters card and alts picker', () => {
  const GRIHZY = {
    id: 1,
    person_id: 70,
    name: 'Grihzy',
    realm: 'Illidan',
    class_name: 'Evoker',
    spec_name: 'Preservation',
    item_level: 701
  };
  const withPerson = (tables: Record<string, (read: Read) => unknown> = {}) => ({
    players: (read: Read) =>
      read.columns === 'team_members(person_id)' ? { data: { team_members: { person_id: 70 } } } : { data: TORBJORN },
    characters: () => ({ data: [GRIHZY] }),
    ...tables
  });

  const answer = {
    success: true,
    characters: [
      {
        blizzard_id: 101,
        name: 'Torbjorn',
        realm: 'Illidan',
        realm_slug: 'illidan',
        class_name: 'Death Knight',
        spec_name: 'Frost',
        level: 90,
        item_level: 708,
        saved: false,
        roster: { player_id: 11, team_id: 1, name_realm: 'Torbjorn-Illidan', outcome: 'already_yours' }
      },
      {
        blizzard_id: 102,
        name: 'Grihzy',
        realm: 'Illidan',
        realm_slug: 'illidan',
        class_name: 'Evoker',
        spec_name: 'Preservation',
        level: 90,
        item_level: 701,
        saved: true,
        roster: null
      },
      {
        blizzard_id: 103,
        name: 'Grihzfrost',
        realm: 'Illidan',
        realm_slug: 'illidan',
        class_name: 'Mage',
        spec_name: 'Frost',
        level: 90,
        item_level: null,
        saved: false,
        roster: null
      },
      {
        blizzard_id: 104,
        name: 'Holygrihz',
        realm: 'Illidan',
        realm_slug: 'illidan',
        class_name: 'Paladin',
        spec_name: 'Holy',
        level: 90,
        item_level: 694,
        saved: false,
        roster: { player_id: 30, team_id: 2, name_realm: 'Holygrihz-Illidan', outcome: 'claimed_by_someone_else' }
      }
    ],
    roster: [
      { player_id: 11, team_id: 1, name_realm: 'Torbjorn-Illidan', outcome: 'already_yours' },
      { player_id: 30, team_id: 2, name_realm: 'Holygrihz-Illidan', outcome: 'claimed_by_someone_else' },
      { player_id: 31, team_id: 1, name_realm: 'Lowbie-Illidan', outcome: 'linked' }
    ]
  };

  it('lists the roster character first, then the alts, on the raider’s own profile', async () => {
    renderApp('/g/wga/t/phoenix/me', profileHandlers(person('raider', 11), withPerson()));
    const card = (await screen.findByRole('heading', { name: 'Characters' })).closest('section')!;
    expect(within(card).getByText('Raiding')).toBeInTheDocument();
    const alts = await within(card).findByRole('list', { name: 'Alts' });
    expect(within(alts).getByText('Grihzy')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Choose alts' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Only you and your team’s officers see your alts.');
  });

  it('shows an officer the alts without the picker', async () => {
    renderApp('/g/wga/t/phoenix/p/tb000011', profileHandlers(person('officer', null), withPerson()));
    const card = (await screen.findByRole('heading', { name: 'Characters' })).closest('section')!;
    expect(await within(card).findByText('Grihzy')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Choose alts' })).not.toBeInTheDocument();
  });

  it('opens on its own after the Battle.net trip, and saves the picked alts', async () => {
    const handlers = {
      ...profileHandlers(person('raider', 11), withPerson()),
      invoke: () => ({ data: answer })
    };
    const { client } = renderApp('/g/wga/t/phoenix/me', handlers, {
      authReturn: { intent: 'choose-alts', error: null },
      battlenetToken: 'bnet-token'
    });
    const dialog = await screen.findByRole('dialog', { name: 'Choose your alts' });
    // Save is still disabled while the characters load, so focus has to land on
    // something else inside the dialog rather than staying on the page behind it.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(await within(dialog).findByText('Phoenix · claimed by you')).toBeInTheDocument();
    expect(within(dialog).getByText('Hellfire Rollers · claimed by another player')).toBeInTheDocument();
    expect(within(dialog).getByText('Ask your officers to check the claim')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Lowbie-Illidan was on Phoenix’s roster, so it’s now your roster character.');
    // Saved before, so it starts as an alt; the rest start as Skip.
    expect(within(dialog).getByRole('group', { name: 'Show Grihzy as' })).toContainElement(
      within(dialog).getAllByRole('button', { name: 'Alt', pressed: true })[0]!
    );
    expect(within(dialog).getByText(/alts? selected/)).toHaveTextContent('1 alt selected');

    const frost = within(dialog).getByRole('group', { name: 'Show Grihzfrost as' });
    await userEvent.click(within(frost).getByRole('button', { name: 'Alt' }));
    expect(within(dialog).getByText(/alts? selected/)).toHaveTextContent('2 alts selected');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save alts' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const calls = client.authCalls.filter(([kind]) => kind === 'invoke').map(([, call]) => call);
    expect(calls).toEqual([
      ['battlenet-characters', { body: { token: 'bnet-token' } }],
      ['battlenet-characters', { body: { token: 'bnet-token', save: [102, 103] } }]
    ]);
  });

  it('sends the raider back to Battle.net when there is no token, and when it has expired', async () => {
    const expired = new Response(JSON.stringify({ success: false, error: 'Your Battle.net sign-in has expired.' }), {
      status: 401
    });
    const noToken = renderApp('/g/wga/t/phoenix/me', profileHandlers(person('raider', 11), withPerson()));
    await userEvent.click(await screen.findByRole('button', { name: 'Choose alts' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Load your characters from Battle.net' }));
    expect(noToken.client.authCalls).toContainEqual([
      'signInWithOAuth',
      expect.objectContaining({ provider: 'custom:battlenet' })
    ]);
    noToken.view.unmount();

    renderApp(
      '/g/wga/t/phoenix/me',
      {
        ...profileHandlers(person('raider', 11), withPerson()),
        invoke: () => ({ error: { message: 'Edge Function returned a non-2xx status code', context: expired } })
      },
      { authReturn: { intent: 'choose-alts', error: null }, battlenetToken: 'old' }
    );
    const dialog = await screen.findByRole('dialog', { name: 'Choose your alts' });
    expect(await within(dialog).findByText('Your Battle.net sign-in has expired.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sign in with Battle.net again' })).toBeInTheDocument();
  });

  it('marks loot received on an earlier character and counts it in the season total', async () => {
    const award = (id: number, player_id: number, name: string, day: number) => ({
      id,
      player_id,
      track: 'Hero',
      season: 'MID2',
      awarded_at: `2026-08-${String(day).padStart(2, '0')}T18:00:00Z`,
      items: { name }
    });
    const base = profileHandlers(
      person('raider', 11),
      withPerson({
        rclc_loot: (read) => ({
          data:
            filterValue(read, 'player_id') === 11
              ? [award(1, 11, 'Mine', 20)]
              : [award(2, 20, 'Old', 12), award(3, 30, 'Left', 5)]
        }),
        players: (read) =>
          read.columns === 'team_members(person_id)'
            ? { data: { team_members: { person_id: 70 } } }
            : read.single
              ? { data: TORBJORN }
              : {
                  data: [
                    { id: 20, name_realm: 'Oldmain-Illidan', team_id: 1 },
                    { id: 30, name_realm: 'Lefty-Illidan', team_id: 2 }
                  ]
                }
      })
    );
    renderApp('/g/wga/t/phoenix/me/loot', {
      ...base,
      rpc: (name, args) =>
        name === 'earlier_characters'
          ? {
              data: [
                { player_id: 11, earlier_player_id: 20 },
                { player_id: 11, earlier_player_id: 30 }
              ]
            }
          : base.rpc!(name, args)
    });
    expect(await screen.findByRole('rowheader', { name: 'Old on Oldmain' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Left on Hellfire Rollers' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Mine' })).toBeInTheDocument();
    expect(document.querySelector('.loot-count')).toHaveTextContent('3');
  });
});
