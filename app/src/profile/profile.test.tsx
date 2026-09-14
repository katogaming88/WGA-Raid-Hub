import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import { attendance, characterLinks, equippedGear, formatJoinDate, seasonCode, seasonLoot } from './profile';

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
    // Only officers can read M+ requests, so a raider's page does not ask.
    expect(client.reads.some((r) => r.table === 'mplus_exclusion_requests')).toBe(false);
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
      '/g/wga/t/phoenix/me',
      profileHandlers(person('raider', 11), { rclc_loot: () => ({ error: { message: 'loot read failed' } }) })
    );
    const loot = (await screen.findByRole('heading', { name: 'Items received' })).closest('section')!;
    const alert = await within(loot).findByRole('alert');
    expect(alert).toHaveTextContent('loot read failed');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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
