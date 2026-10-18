import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import { toRoster, type PlayerRow } from '../roster/roster';
import { bossLineups, nightLineups, raiderLineups, roleLoad, slotsOf, type LineupData } from './lineups';

// The Boss lineups report (#1247): every number from a fixture lineup and a
// fixture set of fights.

const player = (id: number, nameRealm: string, klass: string, spec: string, role: string) =>
  ({
    id,
    name_realm: nameRealm,
    nickname: null,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: klass, spec, role }
  }) satisfies PlayerRow;

const PLAYERS = [
  player(1, 'Torbjorn-Illidan', 'Death Knight', 'Frost', 'Melee'),
  player(2, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee'),
  player(3, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank')
];
const GROUPS = toRoster(PLAYERS, []);

const boss = (raid_date: string, encounter_id: number, position: number, skipped = false) => ({
  raid_date,
  encounter_id,
  position,
  skipped
});
const seats = (raid_date: string, encounter_id: number, ids: number[]) =>
  ids.map((player_id) => ({ raid_date, encounter_id, player_id }));

// Bosses 10 then 20. Aug 5 and Aug 7 have logs; Aug 12 does not yet; Oct 30
// is after "today".
const DATA: LineupData = {
  nightBosses: [
    boss('2026-08-05', 10, 1),
    boss('2026-08-05', 20, 2),
    boss('2026-08-07', 10, 1),
    // Planned, but nobody was recorded for it: not pulled.
    boss('2026-08-07', 20, 2),
    boss('2026-08-07', 30, 3, true),
    boss('2026-08-12', 10, 1),
    boss('2026-08-12', 20, 2),
    boss('2026-10-30', 10, 1)
  ],
  planned: [
    // Torbjorn planned for boss 10 but first in at boss 20: late. Zuggz swaps in.
    ...seats('2026-08-05', 10, [1, 3]),
    ...seats('2026-08-05', 20, [1, 2, 3]),
    ...seats('2026-08-07', 10, [1, 3]),
    ...seats('2026-08-07', 20, [1, 2, 3]),
    ...seats('2026-08-12', 10, [1, 2]),
    ...seats('2026-08-12', 20, [3]),
    ...seats('2026-10-30', 10, [1, 2, 3])
  ],
  played: [
    ...seats('2026-08-05', 10, [3, 2]),
    ...seats('2026-08-05', 20, [1, 2, 3]),
    ...seats('2026-08-07', 10, [1, 3])
  ],
  kills: [
    { raid_date: '2026-08-05', encounter_id: 10 },
    // A kill on a night with no log yet names nobody.
    { raid_date: '2026-08-12', encounter_id: 20 }
  ]
};
const TODAY = '2026-09-01';

describe('slotsOf', () => {
  it('drops skipped bosses, bosses a logged night never pulled, and nights after today', () => {
    expect(slotsOf(DATA, TODAY).map((s) => `${s.date} ${s.bossId}`)).toEqual([
      '2026-08-05 10',
      '2026-08-05 20',
      '2026-08-07 10',
      '2026-08-12 10',
      '2026-08-12 20'
    ]);
  });
});

describe('raiderLineups', () => {
  const raiders = raiderLineups(slotsOf(DATA, TODAY), GROUPS, new Map([[2, 20]]));
  const of = (id: number) => raiders.find((r) => r.playerId === id)!;

  it('counts planned, sat out and the longest run out against the team’s pulls', () => {
    expect([of(1), of(2), of(3)].map((r) => [r.name, r.assigned, r.slots, r.satOut, r.longestSitOut])).toEqual([
      ['Torbjorn', 4, 5, 1, 1],
      ['Zuggz', 2, 5, 3, 1],
      ['Fluphie', 4, 5, 1, 1]
    ]);
  });

  it('counts played, missed and swapped in from logged nights only', () => {
    expect([of(1), of(2), of(3)].map((r) => [r.played, r.missed, r.swappedIn])).toEqual([
      [2, 1, 0],
      [2, 0, 1],
      [3, 0, 0]
    ]);
  });

  it('lists kills they were in for, bosses never in for, and their bonus roll boss', () => {
    expect(of(1).kills).toEqual([]);
    expect(of(2).kills).toEqual([10]);
    expect(of(3).kills).toEqual([10]);
    expect(of(1).neverIn).toEqual([]);
    expect(of(2).bonusRoll).toEqual({ bossId: 20, inFor: 1, slots: 2 });
    expect(of(1).bonusRoll).toBeNull();
  });

  it('a raider never planned or played for a boss has it under Never in for', () => {
    const solo = raiderLineups(slotsOf({ ...DATA, planned: [], played: [] }, TODAY), GROUPS);
    expect(solo[0]!.neverIn).toEqual([10, 20]);
    // With no log at all, Aug 7's boss 20 counts from its plan too: six pulls.
    expect(solo[0]!.longestSitOut).toBe(6);
  });

  it('gives each role’s sit-out spread', () => {
    expect(roleLoad(raiders, GROUPS)).toEqual([
      { role: 'Tank', label: 'Tanks', fewest: 1, most: 1, average: 1 },
      { role: 'Melee', label: 'Melee', fewest: 1, most: 3, average: 2 }
    ]);
  });
});

describe('bossLineups', () => {
  const roleOf = new Map([
    [1, 'Melee'],
    [2, 'Melee'],
    [3, 'Tank']
  ]);
  const [ten, twenty] = bossLineups(slotsOf(DATA, TODAY), [10, 20], roleOf);

  it('splits who always plays a boss from the seats that rotate', () => {
    expect([ten!.slots, ten!.always, [...ten!.rotating].sort(), ten!.rotatingSeats]).toEqual([3, [], [1, 2, 3], 2]);
    expect([twenty!.slots, twenty!.always, [...twenty!.rotating].sort(), twenty!.rotatingSeats]).toEqual([
      2,
      [3],
      [1, 2],
      1
    ]);
  });

  it('averages each role per pull and keeps how often each raider was in', () => {
    expect(ten!.roles.Tank).toBeCloseTo(2 / 3);
    expect(ten!.roles.Melee).toBeCloseTo(4 / 3);
    expect(twenty!.seen.get(3)).toBe(2);
  });

  it('keeps the first kill’s lineup, and only from a logged night', () => {
    expect(ten!.firstKill).toEqual({ date: '2026-08-05', lineup: [3, 2] });
    expect(twenty!.firstKill).toBeNull();
  });
});

describe('nightLineups', () => {
  const nights = nightLineups(DATA, TODAY);

  it('lists nights newest first, each boss planned against the log', () => {
    expect(nights.map((n) => [n.date, n.logged])).toEqual([
      ['2026-08-12', false],
      ['2026-08-07', true],
      ['2026-08-05', true]
    ]);
    expect(nights[1]!.bosses.map((b) => [b.bossId, b.state])).toEqual([
      [10, 'pulled'],
      [20, 'not pulled'],
      [30, 'skipped']
    ]);
    expect(nights[0]!.bosses[0]).toMatchObject({ state: 'planned', planned: 2, played: null, missed: [] });
  });

  it('names who swapped in, who missed and who came late for their first boss', () => {
    const first = nights[2]!;
    expect(first.bosses[0]).toMatchObject({ killed: true, planned: 2, played: 2, swappedIn: [2], missed: [1] });
    expect(first.late).toEqual([{ playerId: 1, plannedFrom: 10, arrivedAt: 20 }]);
    expect(nights[1]!.late).toEqual([]);
  });
});

// The page, for an officer.
function handlers(tables: Record<string, unknown>) {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person')
        return {
          data: {
            site_admin: false,
            guild_officer: false,
            boe_manager: false,
            teams: [{ team_id: 1, team_member_id: 1, role: 'officer', characters: [] }]
          }
        };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table in tables) return { data: tables[read.table] };
      return base.from!(read);
    }
  });
}

const encounter = (id: number, name: string, sort_index: number) => ({
  id,
  name,
  sort_index,
  cap: null,
  zone: { id: 1, name: 'Voidspire', season: 'MID2', is_mini_raid: false, sort_index: 1 }
});

const TABLES = {
  players: PLAYERS.map((p) => ({ ...p, bonus_roll_encounter_id: p.id === 2 ? 20 : null })),
  names: [],
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: '2026-12-31' }],
  raid_encounters: [
    encounter(10, 'Imperator Averzian', 1),
    encounter(20, 'Vorasius the Starved', 2),
    encounter(30, 'Salhadaar', 3)
  ],
  raid_night_bosses: DATA.nightBosses.filter((b) => b.raid_date < '2026-10-01'),
  raid_night_lineups: DATA.planned,
  raid_night_participation: DATA.played,
  team_raid_kills: DATA.kills
};

describe('Boss lineups page', () => {
  it('opens on raiders, most sat out first, with the role spread', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/officer/reports/boss-lineups', handlers(TABLES));
    const table = await screen.findByRole('table', { name: 'Boss lineups by raider' });
    const zuggz = within(table).getByRole('rowheader', { name: /Zuggz/ }).closest('tr')!;
    expect(zuggz).toHaveTextContent('2 of 5 (40%)');
    expect(zuggz).toHaveTextContent('Vorasius: in 1 of 2');
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('Zuggz');
    expect(screen.getByRole('list', { name: 'Sat out, by role' })).toHaveTextContent('Melee sat out 1–3, average 2');
    const read = client.reads.find((r) => r.table === 'raid_night_participation')!;
    expect(read.filters).toContainEqual(['gte', 'raid_date', '2026-07-18']);
  });

  it('shows each boss, and each night planned against the log', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/boss-lineups', handlers(TABLES));
    await screen.findByRole('table', { name: 'Boss lineups by raider' });

    await userEvent.click(screen.getByRole('button', { name: 'Bosses' }));
    const bosses = screen.getByRole('table', { name: 'Boss lineups by boss' });
    expect(within(bosses).getByRole('rowheader', { name: 'Vorasius the Starved' }).closest('tr')).toHaveTextContent(
      '1 among 2'
    );
    expect(within(bosses).getByRole('rowheader', { name: 'Imperator Averzian' }).closest('tr')).toHaveTextContent(
      'Aug 5, 2026, 2 in'
    );

    await userEvent.click(screen.getByRole('button', { name: 'Nights' }));
    const first = screen.getByRole('region', { name: 'Aug 5, 2026' });
    expect(first).toHaveTextContent('Swapped in: Zuggz');
    expect(first).toHaveTextContent('Missed: Torbjorn');
    expect(first).toHaveTextContent('Late: Torbjorn (planned from Imperator Averzian, first in at Vorasius)');
    expect(screen.getByRole('region', { name: 'Aug 12, 2026' })).toHaveTextContent('The log is not in yet');
  });

  it('says so when the season has no lineups yet', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/boss-lineups', handlers({ ...TABLES, raid_night_bosses: [] }));
    expect(await screen.findByText(/No boss lineups planned for Midnight Season 2 yet/)).toBeInTheDocument();
  });
});
