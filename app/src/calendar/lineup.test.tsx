import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import type { PlayerRow } from '../roster/roster';
import type { Answer, RaidNight } from './calendar';
import {
  capLabel,
  capStatus,
  changes,
  comingNights,
  current,
  everyoneIn,
  lineupRaids,
  lineupView,
  groupsView,
  onRoster,
  placesOf,
  seasonOn,
  shortBossName,
  toggle,
  wholeNight,
  yourBosses,
  DEFAULT_ROLE_TARGETS,
  type ComingBossRow,
  type EncounterRow,
  type LeaverRow,
  type NightBossRow,
  type PlaceRow
} from './lineup';

// The boss lineup on a raid night (#1216): the grid's rules, and the officer
// tab on the night page.

const player = (id: number, name: string, cls: string, role: string, flags: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name_realm: `${name}-Illidan`,
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: { class: cls, spec: 'Spec', role },
  ...flags
});

const NIGHT: RaidNight = {
  date: '2026-05-14',
  start: '21:00:00',
  durationMinutes: 180,
  optional: false,
  extra: false,
  note: ''
};

const ABYSS = { id: 10, name: 'The Venomous Abyss', season: 'S1', is_mini_raid: false, sort_index: 0 };
const GROTTO = { id: 11, name: 'Tidebound Grotto', season: 'S1', is_mini_raid: true, sort_index: 1 };
const OLD = { id: 9, name: 'Old Raid', season: 'S0', is_mini_raid: false, sort_index: 0 };

const ENCOUNTERS: EncounterRow[] = [
  { id: 101, name: "Nek'zali the Soulcoiler", sort_index: 1, zone: ABYSS, cap: null },
  { id: 102, name: 'Sszorak', sort_index: 2, zone: ABYSS, cap: null },
  { id: 103, name: 'Nymrissa Wavecaller', sort_index: 1, zone: GROTTO, cap: null },
  { id: 90, name: 'Old Boss', sort_index: 1, zone: OLD, cap: null }
];

// A flex boss inside a Mythic raid: 25 allowed against the raid's own 20
// (#1244, Nymrissa Wavecaller and Kith'ix on production).
const FLEX_ENCOUNTERS: EncounterRow[] = [
  ...ENCOUNTERS,
  { id: 104, name: "Kith'ix", sort_index: 3, zone: ABYSS, cap: 25 }
];

const SEASONS = [
  { code: 'S0', display_name: 'Season Zero', starts_at: '2026-01-01', ends_at: '2026-03-31' },
  { code: 'S1', display_name: 'Season One', starts_at: '2026-04-01', ends_at: null }
];

const nightBoss = (encounter_id: number, position: number, extra: Partial<NightBossRow> = {}): NightBossRow => ({
  raid_date: NIGHT.date,
  encounter_id,
  position,
  skipped: false,
  confirmed_at: null,
  ...extra
});

const ROSTER = [
  player(1, 'Ana', 'Warrior', 'Tank'),
  player(2, 'Bo', 'Priest', 'Heal'),
  player(3, 'Cy', 'Mage', 'Ranged', { is_trial: true }),
  player(4, 'Di', 'Rogue', 'Melee'),
  player(5, 'Ed', 'Druid', 'Ranged', { is_bench: true })
];

const answer = (player_id: number, status: string): Answer => ({
  player_id,
  raid_date: NIGHT.date,
  status,
  updated_at: '2026-05-14T12:00:00Z'
});

const places = (rows: [number, number[]][]): PlaceRow[] =>
  rows.flatMap(([encounter_id, ids]) => ids.map((player_id) => ({ encounter_id, player_id })));

describe('the lineup rules', () => {
  it('shortens boss names for a grid column, and only a one-word name', () => {
    expect(shortBossName("Nek'zali the Soulcoiler")).toBe("Nek'zali");
    expect(shortBossName('The Lost Explorers')).toBe('Lost Explorers');
    expect(shortBossName('Vashnik, the Malignant')).toBe('Vashnik');
    expect(shortBossName('Sszorak')).toBe('Sszorak');
    expect(shortBossName('Vexie and the Geargrinders')).toBe('Vexie and the Geargrinders');
    expect(shortBossName('Assault of the Zaqali')).toBe('Assault of the Zaqali');
  });

  it('finds the season a night falls in', () => {
    expect(seasonOn(SEASONS, '2026-02-01')).toBe('S0');
    expect(seasonOn(SEASONS, NIGHT.date)).toBe('S1');
    expect(seasonOn(SEASONS, '2025-12-31')).toBeNull();
  });

  it('lists the night’s bosses as raids in pull order, 25 a boss for a mini raid and 20 otherwise', () => {
    const bosses = [nightBoss(103, 3), nightBoss(102, 2, { confirmed_at: '2026-05-13T00:00:00Z' }), nightBoss(101, 1)];
    expect(lineupRaids(ENCOUNTERS, bosses, { fresh: false, season: 'S1' })).toEqual([
      {
        zoneId: 10,
        name: 'The Venomous Abyss',
        cap: 20,
        bosses: [
          { id: 101, name: "Nek'zali the Soulcoiler", short: "Nek'zali", skipped: false, confirmed: false, cap: 20 },
          { id: 102, name: 'Sszorak', short: 'Sszorak', skipped: false, confirmed: true, cap: 20 }
        ]
      },
      {
        zoneId: 11,
        name: 'Tidebound Grotto',
        cap: 25,
        bosses: [
          {
            id: 103,
            name: 'Nymrissa Wavecaller',
            short: 'Nymrissa Wavecaller',
            skipped: false,
            confirmed: false,
            cap: 25
          }
        ]
      }
    ]);
    // Nothing planned yet: nothing, unless starting the very first night.
    expect(lineupRaids(ENCOUNTERS, [], { fresh: false, season: 'S1' })).toEqual([]);
    const fresh = lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' });
    expect(fresh.flatMap((r) => r.bosses.map((b) => b.id))).toEqual([101, 102, 103]);
  });

  it('gives a boss its own cap when one is set, over the raid’s (#1244, a flex boss)', () => {
    const raids = lineupRaids(FLEX_ENCOUNTERS, [], { fresh: true, season: 'S1' });
    const abyss = raids.find((r) => r.zoneId === 10)!;
    expect(abyss.cap).toBe(20);
    expect(abyss.bosses.map((b) => [b.short, b.cap])).toEqual([
      ["Nek'zali", 20],
      ['Sszorak', 20],
      ["Kith'ix", 25]
    ]);
    expect(capLabel(abyss.bosses)).toBe('20-25 per boss');
    const grotto = raids.find((r) => r.zoneId === 11)!;
    expect(capLabel(grotto.bosses)).toBe('25 per boss');
  });

  it('keeps edits only where they differ from what is saved', () => {
    const saved = placesOf(places([[101, [1, 2]]]));
    let edits = toggle(saved, new Map(), 101, 2);
    expect([...current(saved, edits).get(101)!]).toEqual([1]);
    expect(changes(saved, edits)).toEqual({ bosses: [101], cells: 1 });
    // Clicking back leaves no edit behind.
    edits = toggle(saved, edits, 101, 2);
    expect(edits.size).toBe(0);
    expect(changes(saved, edits)).toEqual({ bosses: [], cells: 0 });
  });

  it('puts a bench raider in, or out, for every boss still on the night', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2, { skipped: true })], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const edits = wholeNight(new Map(), new Map(), raid.bosses, 5, true);
    expect([...edits.keys()]).toEqual([101]);
    expect(wholeNight(new Map(), edits, raid.bosses, 5, false).size).toBe(0);
  });

  it('starts the very first night with everyone in but the bench', () => {
    const raid = lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' })[0]!;
    const edits = everyoneIn(ROSTER, raid.bosses);
    expect([...edits.get(101)!].sort()).toEqual([1, 2, 3, 4]);
  });

  it('says how full a boss is', () => {
    expect(capStatus(20, 20)).toEqual({ text: 'Full', tone: 'good' });
    expect(capStatus(19, 20)).toEqual({ text: '1 open spot', tone: 'warn' });
    expect(capStatus(15, 20)).toEqual({ text: '5 open spots', tone: 'warn' });
    expect(capStatus(22, 20)).toEqual({ text: '2 over', tone: 'bad' });
  });

  it('lists everyone on the roster, marks changes from the group and raiders in who said they’re out', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2)], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const tonight = placesOf(
      places([
        [101, [1, 2, 3, 4]],
        [102, [2, 3]]
      ])
    );
    const usual = placesOf(
      places([
        [101, [1, 2, 3]],
        [102, [1, 2, 3]]
      ])
    );
    // Bo is late; Di answered Absent after being planned in; Ed is on the bench.
    const view = lineupView(ROSTER, NIGHT, [answer(2, 'Late'), answer(4, 'Absent')], raid, tonight, usual);

    expect(view.groups.map((g) => [g.label, g.rows.map((r) => [r.row.name, r.tag, r.count])])).toEqual([
      ['Tanks', [['Ana', null, 1]]],
      ['Healers', [['Bo', 'Late', 2]]],
      ['Melee', [['Di', 'Absent', 1]]],
      [
        'Ranged',
        [
          ['Cy', 'Trial', 2],
          ['Ed', 'Bench', 0]
        ]
      ]
    ]);
    const ana = view.groups[0]!.rows[0]!;
    // Ana is usually in on Sszorak, out tonight.
    expect(ana.cells.map((c) => [c.in, c.differs])).toEqual([
      [true, false],
      [false, true]
    ]);
    const di = view.groups[2]!.rows[0]!;
    expect(di.tagTone).toBe('out');
    expect(di.cells.map((c) => [c.in, c.conflict, c.differs])).toEqual([
      [true, true, true],
      [false, false, false]
    ]);
    expect(view.benchOut).toEqual(['Ed']);

    const [nekzali, sszorak] = view.totals;
    expect([nekzali!.count, nekzali!.tanks, nekzali!.healers, nekzali!.damage]).toEqual([4, 1, 1, 2]);
    expect(nekzali!.problems).toEqual([
      '16 open spots',
      '1 tank',
      '1 healer',
      expect.stringMatching(/^no Mark of the Wild, /),
      'Di said they’re not coming'
    ]);
    expect(sszorak!.problems.slice(0, 2)).toEqual(['18 open spots', 'no tanks']);
    const battleShout = view.buffs.find((r) => r.buff.name === 'Battle Shout')!;
    expect(battleShout.cells.map((c) => c.providers)).toEqual([['Ana'], []]);
  });

  it('checks a boss against the team’s own role targets, not the default (#1244)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1)], { fresh: false, season: 'S1' })[0]!;
    // One tank (Ana), one healer (Bo): short of the default's 2 tanks / 4
    // healers, but enough for a team that wants only one of each.
    const tonight = placesOf(places([[101, [1, 2, 3, 4]]]));
    const asDefault = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight);
    expect(asDefault.totals[0]!.problems).toEqual(expect.arrayContaining(['1 tank', '1 healer']));
    const wantsLess = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, { tanks: 1, healers: 1 });
    expect(wantsLess.totals[0]!.problems).not.toContain('1 tank');
    expect(wantsLess.totals[0]!.problems).not.toContain('1 healer');
    // Explicit DEFAULT_ROLE_TARGETS matches the no-argument call.
    expect(lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, DEFAULT_ROLE_TARGETS)).toEqual(asDefault);
  });

  it('reports tanks by count against the target, not a fixed "needs a second tank" (Rex’s review of #1256)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1)], { fresh: false, season: 'S1' })[0]!;
    // Two tanks in (Ana and a second), short of a team that wants three.
    const secondTank = player(6, 'Az', 'Paladin', 'Tank');
    const tonight = placesOf(places([[101, [1, 6]]]));
    const wantsThree = lineupView([...ROSTER, secondTank], NIGHT, [], raid, tonight, tonight, {
      tanks: 3,
      healers: 0
    });
    expect(wantsThree.totals[0]!.problems).toContain('2 tanks');
    expect(wantsThree.totals[0]!.problems).not.toContain('needs a second tank');

    // A team that wants no tanks at all is never told it has none.
    const noTanksWanted = lineupView(ROSTER, NIGHT, [], raid, placesOf(places([[101, [2]]])), tonight, {
      tanks: 0,
      healers: 0
    });
    expect(noTanksWanted.totals[0]!.problems.some((p) => p.includes('tank'))).toBe(false);
  });

  it('leaves a skipped boss out of the counts and checks', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2, { skipped: true })], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const view = lineupView(ROSTER, NIGHT, [], raid, placesOf(places([[101, [1]]])), new Map());
    expect(view.live.map((b) => b.id)).toEqual([101]);
    expect(view.totals.map((t) => t.boss.id)).toEqual([101]);
    expect(view.groups[0]!.rows[0]!.cells.map((c) => [c.in, c.differs])).toEqual([
      [true, true],
      [false, false]
    ]);
  });

  it('warns about buffs only once a boss is full', () => {
    const full = {
      zoneId: 1,
      name: 'R',
      cap: 2,
      bosses: [{ id: 1, name: 'B', short: 'B', skipped: false, confirmed: false, cap: 2 }]
    };
    const two = [player(1, 'Ana', 'Warrior', 'Tank'), player(2, 'Bo', 'Warrior', 'Tank')];
    const total = lineupView(two, NIGHT, [], full, placesOf(places([[1, [1, 2]]])), new Map()).totals[0]!;
    expect(total.warn).toBe('12 buffs');
    expect(total.problems).toEqual(['0 healers', expect.stringMatching(/^no Mark of the Wild/)]);
  });
});

// The page

const who = (role: string) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Ana-Illidan', url_code: null, archived_at: null }]
    }
  ]
});

type Setup = {
  bosses?: NightBossRow[];
  tonight?: PlaceRow[];
  groups?: PlaceRow[];
  answers?: Answer[];
  targets?: { tanks_wanted: number; healers_wanted: number };
  rpc?: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } } | undefined;
};

const PLANNED: Setup = {
  bosses: [nightBoss(101, 1), nightBoss(102, 2), nightBoss(103, 3)],
  tonight: places([
    [101, [1, 2, 3]],
    [102, [1, 2]],
    [103, [1, 2, 3, 4]]
  ]),
  groups: places([
    [101, [1, 2, 3]],
    [102, [1, 2, 3]],
    [103, [1, 2, 3, 4]]
  ])
};

function handlers(person: ReturnType<typeof who>, setup: Setup = PLANNED): FakeHandlers {
  const base = seededHandlers();
  const tables: Record<string, (read: Read) => unknown> = {
    raid_schedule: () =>
      [2, 4].map((weekday) => ({ weekday, start_time: '21:00:00', duration_minutes: 180, is_optional: false })),
    raid_schedule_exceptions: () => [],
    players: () => ROSTER,
    raid_rsvps: () => setup.answers ?? [],
    seasons: () => SEASONS,
    raid_encounters: () => ENCOUNTERS,
    raid_night_bosses: () => setup.bosses ?? [],
    raid_night_lineups: () => setup.tonight ?? [],
    boss_groups: () => setup.groups ?? [],
    team_lineup_settings: (read) => (read.single ? (setup.targets ?? null) : setup.targets ? [setup.targets] : [])
  };
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      const custom = setup.rpc?.(name, args);
      if (custom) return custom;
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person };
      if (name === 'team_rsvp_answers') return { data: [] };
      if (name === 'set_raid_night_lineup' || name === 'set_boss_group') return { data: 1 };
      if (name === 'plan_raid_night') return { data: 3 };
      if (name === 'set_raid_night_boss_skipped') return { data: null };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table in tables) return { data: tables[read.table]!(read) };
      return base.from!(read);
    }
  });
}

const LINEUP = '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup';
const grid = async () =>
  within(await screen.findByRole('table', { name: /The Venomous Abyss lineup for Thu, May 14/ }));
const rpcs = (client: { rpcs: [string, unknown][] }, name: string) =>
  client.rpcs.filter(([n]) => n === name).map(([, args]) => args);

describe('the boss lineup tab', () => {
  it('is not offered to a raider', async () => {
    renderApp(LINEUP, handlers(who('raider')));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Boss lineup' })).not.toBeInTheDocument();
  });

  it('opens from the night page for an officer, and stepping nights keeps it open', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(who('officer')));
    const tab = await screen.findByRole('link', { name: 'Boss lineup' });
    expect(tab).toHaveAttribute('href', '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup');
    expect(screen.getByRole('link', { name: 'Who’s coming' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Next raid night/ })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-19'
    );
  });

  it('keeps the boss lineup open when stepping to the next night', async () => {
    renderApp(LINEUP, handlers(who('officer')));
    await grid();
    expect(screen.getByRole('link', { name: /^Next raid night/ })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-19&view=lineup'
    );
  });

  it('shows everyone on the roster, with the bench out and changes from the group marked', async () => {
    renderApp(LINEUP, handlers(who('officer'), { ...PLANNED, answers: [answer(3, 'Absent')] }));
    const g = await grid();
    expect(g.getByRole('button', { name: "Ed, Nek'zali the Soulcoiler: out" })).toBeInTheDocument();
    expect(
      g.getByRole('button', { name: 'Cy, Sszorak: out, changed for tonight only, usually in' })
    ).toBeInTheDocument();
    expect(
      g.getByRole('button', { name: "Cy, Nek'zali the Soulcoiler: in, but said they’re not coming" })
    ).toBeInTheDocument();
    // The count against the cap is read out, not only shown.
    expect(
      g.getByRole('columnheader', { name: /^Sszorak\s*2\/20\s*18 open spots\s*1 tank, 1 healer, 0 damage/ })
    ).toBeInTheDocument();
    const look = within(screen.getByRole('region', { name: 'Needs a look' }));
    expect(look.getByText('Ed is out on every boss unless you put them in.')).toBeInTheDocument();
  });

  it('saves a change for tonight only', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const tonight = screen.getByRole('button', { name: 'Save tonight' });
    expect(tonight).toBeDisabled();
    expect(screen.getByText('No unsaved changes. Click a cell to swap someone in or out.')).toBeInTheDocument();

    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in" }));
    expect(screen.getByText('1 unsaved change.')).toBeInTheDocument();
    await user.click(tonight);

    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_encounter_id: 101,
        p_player_ids: [1, 3],
        p_expected_player_ids: [1, 2, 3]
      }
    ]);
    expect(rpcs(client, 'set_boss_group')).toEqual([]);
    expect((await screen.findAllByText('Saved the lineup for Thu, May 14.')).length).toBeGreaterThan(0);
    // The editor stays put, so keyboard focus is not thrown to the top.
    expect(tonight).toBeInTheDocument();
  });

  it('saves to the group: tonight first, then the usual group', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));
    await user.click(screen.getByRole('button', { name: 'Save to the group' }));

    const order = client.rpcs.map(([n]) => n).filter((n) => n.startsWith('set_'));
    expect(order).toEqual(['set_raid_night_lineup', 'set_boss_group']);
    // Sszorak's group had Cy too; what is on screen becomes the group.
    expect(rpcs(client, 'set_boss_group')).toEqual([
      { p_team_id: 1, p_encounter_id: 102, p_player_ids: [2], p_expected_player_ids: [1, 2, 3] }
    ]);
  });

  it('says which boss was held back when someone else saved it first', async () => {
    const user = userEvent.setup();
    renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        rpc: (name) =>
          name === 'set_raid_night_lineup'
            ? {
                error: {
                  message: 'Someone else changed this boss’s lineup since you opened it. Reload to see their change.'
                }
              }
            : undefined
      })
    );
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));
    await user.click(screen.getByRole('button', { name: 'Save tonight' }));
    expect(await screen.findByText('Sszorak wasn’t saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show their version' }));
    expect(g.getByRole('button', { name: 'Ana, Sszorak: in' })).toBeInTheDocument();
    expect(screen.getByText('No unsaved changes. Click a cell to swap someone in or out.')).toBeInTheDocument();
  });

  it('puts a bench raider in for the whole night', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ed in all night' }));
    expect(
      g.getByRole('button', { name: 'Ed, Sszorak: in, changed for tonight only, usually out' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 unsaved changes.')).toBeInTheDocument();
  });

  it('skips a boss for the night', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    await grid();
    await user.click(screen.getByRole('button', { name: 'Skip Sszorak tonight' }));
    expect(rpcs(client, 'set_raid_night_boss_skipped')).toEqual([
      { p_team_id: 1, p_raid_date: '2026-05-14', p_encounter_id: 102, p_skipped: true }
    ]);
  });

  it('keeps unsaved changes while switching raids, and asks before leaving the night', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));

    await user.click(screen.getByRole('button', { name: /Tidebound Grotto/ }));
    expect(screen.getByRole('button', { name: 'Ana, Nymrissa Wavecaller: in' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /The Venomous Abyss/ }));
    expect(
      screen.getByRole('button', { name: 'Ana, Sszorak: out, changed for tonight only, usually in' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Who’s coming' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Leave without saving?' }));
    expect(dialog.getByText(/You have 1 unsaved change to this night’s boss lineup/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 unsaved change.')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Who’s coming' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave and discard' }));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
  });

  it('fills a night that is not planned yet from the groups', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer'), { groups: PLANNED.groups! }));
    expect(await screen.findByRole('heading', { name: 'This night isn’t planned yet.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill from the groups' }));
    expect(rpcs(client, 'plan_raid_night')).toEqual([{ p_team_id: 1, p_raid_date: '2026-05-14' }]);
  });

  it('starts the very first night with everyone in but the bench', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer'), {}));
    expect(await screen.findByRole('heading', { name: 'No boss has a usual group yet.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start with everyone in' }));
    const g = await grid();
    expect(
      g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in, changed for tonight only, usually out" })
    ).toBeInTheDocument();
    expect(g.getByRole('button', { name: "Ed, Nek'zali the Soulcoiler: out" })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save to the group' }));
    expect(rpcs(client, 'set_raid_night_lineup')).toHaveLength(3);
    expect(rpcs(client, 'set_boss_group')).toHaveLength(3);
    expect(rpcs(client, 'set_boss_group')[0]).toEqual({
      p_team_id: 1,
      p_encounter_id: 101,
      p_player_ids: [1, 2, 3, 4],
      p_expected_player_ids: []
    });
  });
});

// The Boss groups page (#1216, board I)

const abyss = () => lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' })[0]!;

describe('the boss groups rules', () => {
  it('keeps only raiders still on the roster', () => {
    const kept = onRoster(placesOf(places([[101, [1, 2, 99]]])), ROSTER);
    expect([...kept.get(101)!]).toEqual([1, 2]);
  });

  it('marks unsaved cells, the bench, and raiders in no group of the raid', () => {
    const saved = placesOf(
      places([
        [101, [1, 2, 3]],
        [102, [1, 2]]
      ])
    );
    const view = groupsView(ROSTER, abyss(), current(saved, toggle(saved, new Map(), 102, 3)), saved, []);
    const row = (name: string) => view.groups.flatMap((g) => g.rows).find((r) => r.raider.name === name)!;
    expect(row('Cy').cells.map((c) => [c.in, c.changed])).toEqual([
      [true, false],
      [true, true]
    ]);
    expect(row('Di').tag).toBe('In no group');
    expect(row('Ed').tag).toBe('Bench');
    expect(view.unplaced).toEqual(['Di']);
    expect(view.bench).toEqual(['Ed']);
    expect(view.totals.map((t) => t.count)).toEqual([3, 3]);
  });

  it('names someone who left the roster but is still in a group', () => {
    const flame = { name_realm: 'Flame-Illidan', nickname: null };
    const rows: LeaverRow[] = [
      { encounter_id: 101, player_id: 99, player: flame },
      { encounter_id: 102, player_id: 99, player: flame },
      { encounter_id: 103, player_id: 99, player: flame },
      { encounter_id: 101, player_id: 1, player: { name_realm: 'Ana-Illidan', nickname: null } }
    ];
    const view = groupsView(ROSTER, abyss(), new Map(), new Map(), rows);
    // Only this raid's groups count: 103 is in the Grotto.
    expect(view.leavers).toEqual([{ name: 'Flame', bosses: 2 }]);
  });

  it('says what a save changes on coming nights already filled', () => {
    const bosses = abyss().bosses;
    const coming: ComingBossRow[] = [
      { raid_date: '2026-05-19', encounter_id: 101, skipped: false, confirmed_at: null },
      { raid_date: '2026-05-19', encounter_id: 102, skipped: false, confirmed_at: null },
      { raid_date: '2026-05-21', encounter_id: 101, skipped: false, confirmed_at: '2026-05-18T10:00:00Z' },
      { raid_date: '2026-05-21', encounter_id: 102, skipped: true, confirmed_at: null },
      { raid_date: '2026-05-21', encounter_id: 103, skipped: false, confirmed_at: null }
    ];
    expect(comingNights(coming, bosses, [])).toEqual([
      { date: '2026-05-19', text: 'Filled from the groups; nobody has changed it yet.' },
      { date: '2026-05-21', text: "Nek'zali saved for that night; Sszorak skipped. The rest follows the groups." }
    ]);
    expect(comingNights(coming, bosses, [101, 102])).toEqual([
      { date: '2026-05-19', text: "Will follow for Nek'zali and Sszorak." },
      { date: '2026-05-21', text: "Nek'zali stays as saved for that night. Sszorak is skipped that night." }
    ]);
  });
});

const GROUPS = '/g/wga/t/phoenix/officer/groups';
const groupsGrid = async () =>
  within(await screen.findByRole('table', { name: /The Venomous Abyss boss groups, up to 20 per boss/ }));

const GROUPED: Setup = {
  bosses: [nightBoss(101, 1), nightBoss(102, 2, { confirmed_at: '2026-05-13T10:00:00Z' })],
  groups: [
    ...places([
      [101, [1, 2, 3]],
      [102, [1, 2]]
    ]),
    { encounter_id: 101, player_id: 99 }
  ]
};

const STALE_GROUP = 'Someone else changed this group since you opened it. Reload to see their change.';

describe('the boss groups page', () => {
  it('is in the Officer menu, and only for officers', async () => {
    renderApp(GROUPS, handlers(who('raider'), GROUPED));
    expect(await screen.findByText('This page is for officers of Phoenix.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Boss groups' })).not.toBeInTheDocument();
  });

  it('shows the usual groups with the checks and what saving changes', async () => {
    renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    expect(screen.getByRole('link', { name: 'Boss groups' })).toHaveAttribute('aria-current', 'page');
    expect(g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in the group" })).toBeInTheDocument();
    expect(g.getByRole('button', { name: 'Cy, Sszorak: not in the group' })).toBeInTheDocument();
    expect(g.getByText('In no group')).toBeInTheDocument();
    const look = within(screen.getByRole('region', { name: 'Needs a look' }));
    expect(look.getByText('Di is in no group yet.')).toBeInTheDocument();
    expect(look.getByText(/Ed is on the bench/)).toBeInTheDocument();
    const nights = within(screen.getByRole('region', { name: 'Coming nights' }));
    expect(nights.getByText('Sszorak saved for that night. The rest follows the groups.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Thursday’s lineup ›' })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup'
    );
  });

  it('saves the changed groups, leaving out anyone who left the roster', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    const save = screen.getByRole('button', { name: 'Save groups' });
    expect(save).toBeDisabled();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    expect(g.getByRole('button', { name: 'Di, Sszorak: in the group, not saved yet' })).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change.')).toBeInTheDocument();
    const nights = within(screen.getByRole('region', { name: 'Coming nights' }));
    expect(nights.getByText('Sszorak stays as saved for that night.')).toBeInTheDocument();
    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in the group" }));
    await user.click(save);

    expect(rpcs(client, 'set_boss_group')).toEqual([
      { p_team_id: 1, p_encounter_id: 102, p_player_ids: [1, 2, 4], p_expected_player_ids: [1, 2] },
      { p_team_id: 1, p_encounter_id: 101, p_player_ids: [1, 3], p_expected_player_ids: [1, 2, 3, 99] }
    ]);
    expect((await screen.findAllByText(/^Saved the boss groups\./)).length).toBeGreaterThan(0);
  });

  it('says which group was held back when someone else saved it first', async () => {
    const user = userEvent.setup();
    renderApp(
      GROUPS,
      handlers(who('officer'), {
        ...GROUPED,
        rpc: (name) => (name === 'set_boss_group' ? { error: { message: STALE_GROUP } } : undefined)
      })
    );
    const g = await groupsGrid();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    await user.click(screen.getByRole('button', { name: 'Save groups' }));
    expect(await screen.findByText('Sszorak wasn’t saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show their version' }));
    expect(g.getByRole('button', { name: 'Di, Sszorak: not in the group' })).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    await user.click(screen.getByRole('link', { name: 'Roster' }));
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toHaveTextContent(
      'You have 1 unsaved change to the boss groups.'
    );
  });

  it('shows the team’s own role targets, defaulting to 2 tanks and 4 healers, and lets an officer change them', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), GROUPED));
    await groupsGrid();
    expect(screen.getByText('Role targets: 2 tanks · 4 healers')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Role targets' }));
    await user.clear(dialog.getByLabelText('Tanks wanted'));
    await user.type(dialog.getByLabelText('Tanks wanted'), '3');
    await user.clear(dialog.getByLabelText('Healers wanted'));
    await user.type(dialog.getByLabelText('Healers wanted'), '5');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(rpcs(client, 'set_lineup_role_targets')).toEqual([{ p_team_id: 1, p_tanks: 3, p_healers: 5 }]);
    expect(await screen.findByText('Role targets saved: 3 tanks and 5 healers.')).toBeInTheDocument();
  });

  it('reads a team’s own saved role targets', async () => {
    renderApp(GROUPS, handlers(who('officer'), { ...GROUPED, targets: { tanks_wanted: 3, healers_wanted: 6 } }));
    await groupsGrid();
    expect(await screen.findByText('Role targets: 3 tanks · 6 healers')).toBeInTheDocument();
  });

  it('offers no cap edit to a team officer, only to a guild officer or site admin', async () => {
    renderApp(GROUPS, handlers(who('officer'), GROUPED));
    await groupsGrid();
    expect(screen.queryByRole('button', { name: 'Edit cap' })).not.toBeInTheDocument();
  });

  it('lets a guild officer set a boss’s cap, for every team', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers({ ...who('officer'), guild_officer: true }, GROUPED));
    const g = await groupsGrid();
    await user.click(
      within(g.getByRole('columnheader', { name: /Sszorak/ })).getByRole('button', { name: 'Edit cap' })
    );
    const dialog = within(await screen.findByRole('dialog', { name: 'Sszorak’s cap' }));
    expect(dialog.getByLabelText('Cap for this boss')).toHaveValue(null);
    await user.type(dialog.getByLabelText('Cap for this boss'), '25');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(rpcs(client, 'set_encounter_cap')).toEqual([{ p_encounter_id: 102, p_cap: 25 }]);
    expect(await screen.findByText('Sszorak’s cap is set to 25, for every team.')).toBeInTheDocument();
  });
});

describe('the boss lineup, after someone leaves the roster', () => {
  it('leaves them out of a night’s save', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      LINEUP,
      handlers(who('officer'), { ...PLANNED, tonight: [...PLANNED.tonight!, { encounter_id: 101, player_id: 99 }] })
    );
    const g = await grid();
    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in" }));
    await user.click(screen.getByRole('button', { name: 'Save tonight' }));
    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_encounter_id: 101,
        p_player_ids: [1, 3],
        p_expected_player_ids: [1, 2, 3, 99]
      }
    ]);
  });
});

describe('the boss groups page, before any group is set', () => {
  it('starts with everyone in but the bench, and saves every boss', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), {}));
    expect(
      await screen.findByRole('heading', { name: 'No boss in The Venomous Abyss has a usual group yet.' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start with everyone in' }));
    const g = await groupsGrid();
    expect(g.getByRole('button', { name: 'Di, Sszorak: in the group, not saved yet' })).toBeInTheDocument();
    expect(g.getByRole('button', { name: 'Ed, Sszorak: not in the group' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save groups' }));
    expect(rpcs(client, 'set_boss_group')).toEqual([
      { p_team_id: 1, p_encounter_id: 101, p_player_ids: [1, 2, 3, 4], p_expected_player_ids: [] },
      { p_team_id: 1, p_encounter_id: 102, p_player_ids: [1, 2, 3, 4], p_expected_player_ids: [] }
    ]);
  });
});

// A raider's own bosses (#1216, boards C and D)

describe('your bosses tonight', () => {
  const raids = (bosses: NightBossRow[]) => lineupRaids(ENCOUNTERS, bosses, { fresh: false, season: null });
  const saved = { confirmed_at: '2026-05-13T10:00:00Z' };

  it('says which bosses a raider sits out', () => {
    const card = yourBosses(
      raids([nightBoss(101, 1, saved), nightBoss(102, 2, saved), nightBoss(103, 3, saved)]),
      placesOf(
        places([
          [101, [1, 2]],
          [102, [2]],
          [103, [1, 2]]
        ])
      ),
      ROSTER[0]!
    )!;
    expect(card.summary).toBe('In for 2 of 3 bosses. You sit out Sszorak.');
    expect(card.tiles.map((t) => [t.n, t.in])).toEqual([
      [1, true],
      [2, false],
      [3, true]
    ]);
    expect(card.notFinal).toBeNull();
  });

  it('marks a night filled from the groups as not final, boss by boss', () => {
    const all = places([
      [101, [1]],
      [102, [1]]
    ]);
    expect(yourBosses(raids([nightBoss(101, 1), nightBoss(102, 2)]), placesOf(all), ROSTER[0]!)!.notFinal).toBe(
      'From the usual groups; your officers haven’t finalized it yet.'
    );
    const card = yourBosses(raids([nightBoss(101, 1, saved), nightBoss(102, 2)]), placesOf(all), ROSTER[0]!)!;
    expect(card.summary).toBe('In for all 2 bosses.');
    expect(card.notFinal).toBe('Sszorak is from the usual groups and not final yet.');
    const mostlyUnsaved = yourBosses(
      raids([nightBoss(101, 1, saved), nightBoss(102, 2), nightBoss(103, 3)]),
      placesOf(all),
      ROSTER[0]!
    )!;
    expect(mostlyUnsaved.notFinal).toBe("Nek'zali is final; the rest are from the usual groups and not final yet.");
  });

  it('leaves skipped bosses off, tells the bench, and shows nothing on a night with no lineup', () => {
    const bench = ROSTER[4]!;
    const card = yourBosses(raids([nightBoss(101, 1, saved), nightBoss(102, 2, { skipped: true })]), new Map(), bench)!;
    expect(card.tiles.map((t) => t.name)).toEqual(["Nek'zali the Soulcoiler"]);
    expect(card.summary).toBe('You’re on the bench, so you’re out for every boss unless your officers put you in.');
    expect(yourBosses(raids([]), new Map(), bench)).toBeNull();
  });
});

describe('the night page for a raider', () => {
  const NIGHT_PAGE = '/g/wga/t/phoenix/calendar?date=2026-05-14';

  it('shows their bosses, and a sit-out is not in Heads up', async () => {
    renderApp(
      NIGHT_PAGE,
      handlers(who('raider'), {
        ...PLANNED,
        tonight: places([
          [101, [1, 2, 3]],
          [102, [2]],
          [103, [1, 2, 3, 4]]
        ])
      })
    );
    const cards = await screen.findAllByRole('region', { name: 'Your bosses tonight' });
    const card = within(cards[0]!);
    expect(card.getByText('In for 2 of 3 bosses. You sit out Sszorak.')).toBeInTheDocument();
    expect(card.getByText('Not final yet')).toBeInTheDocument();
    expect(card.getByText('From the usual groups; your officers haven’t finalized it yet.')).toBeInTheDocument();
    const headsUp = within(screen.getByRole('region', { name: 'Heads up' }));
    expect(headsUp.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('shows no card on a night with no boss lineup', async () => {
    renderApp(NIGHT_PAGE, handlers(who('raider'), {}));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your bosses tonight' })).not.toBeInTheDocument();
  });
});
