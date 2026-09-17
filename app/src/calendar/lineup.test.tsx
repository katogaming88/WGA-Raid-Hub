import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import type { PlayerRow } from '../roster/roster';
import type { Answer, RaidNight } from './calendar';
import {
  capStatus,
  lastWeeksNight,
  lineupRaids,
  lineupView,
  shortBossName,
  sitoutKey,
  sitoutsFor,
  sitoutsToSave,
  toggleSitout,
  type SitoutRow
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

const RAIDS = [
  {
    name: 'The Venomous Abyss',
    bosses: [{ name: "Nek'zali the Soulcoiler" }, { name: 'Sszorak' }, { name: '' }]
  },
  { name: 'Tidebound Grotto', isMiniRaid: true, bosses: [{ name: 'Nymrissa Wavecaller' }] },
  { name: 'Empty', bosses: [] }
];

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

describe('the lineup rules', () => {
  it('shortens boss names for a grid column', () => {
    expect(shortBossName("Nek'zali the Soulcoiler")).toBe("Nek'zali");
    expect(shortBossName('The Lost Explorers')).toBe('Lost Explorers');
    expect(shortBossName('Vashnik, the Malignant')).toBe('Vashnik');
    expect(shortBossName('Sszorak')).toBe('Sszorak');
  });

  it('takes the raids with bosses from Season Settings, 25 a boss for a mini raid and 20 otherwise', () => {
    expect(lineupRaids(RAIDS)).toEqual([
      {
        name: 'The Venomous Abyss',
        cap: 20,
        bosses: [
          { name: "Nek'zali the Soulcoiler", short: "Nek'zali" },
          { name: 'Sszorak', short: 'Sszorak' }
        ]
      },
      { name: 'Tidebound Grotto', cap: 25, bosses: [{ name: 'Nymrissa Wavecaller', short: 'Nymrissa Wavecaller' }] }
    ]);
  });

  it('says how full a boss is', () => {
    expect(capStatus(20, 20)).toEqual({ text: 'Full', tone: 'good' });
    expect(capStatus(19, 20)).toEqual({ text: '1 open spot', tone: 'warn' });
    expect(capStatus(15, 20)).toEqual({ text: '5 open spots', tone: 'warn' });
    expect(capStatus(22, 20)).toEqual({ text: '2 over', tone: 'bad' });
  });

  it('lists who is coming by role, with a cell per boss, counts and buffs', () => {
    const raid = lineupRaids(RAIDS)[0]!;
    const sitouts = new Set([sitoutKey('Sszorak', 1), sitoutKey('Sszorak', 3)]);
    // Bo is late; Di is out; Ed is on the bench.
    const view = lineupView(ROSTER, NIGHT, [answer(2, 'Late'), answer(4, 'Absent')], raid, sitouts);

    expect(view.groups.map((g) => [g.label, g.rows.map((r) => [r.row.name, r.tag, r.count])])).toEqual([
      ['Tanks', [['Ana', null, 1]]],
      ['Healers', [['Bo', 'Late', 2]]],
      ['Ranged', [['Cy', 'Trial', 1]]]
    ]);
    expect(view.groups[0]!.rows[0]!.cells.map((c) => c.in)).toEqual([true, false]);
    expect(view.notComing.map((r) => [r.name, r.status.label])).toEqual([
      ['Di', 'Absent'],
      ['Ed', 'Bench']
    ]);

    const [nekzali, sszorak] = view.totals;
    expect([nekzali!.count, nekzali!.tanks, nekzali!.healers, nekzali!.dps]).toEqual([3, 1, 1, 1]);
    expect(nekzali!.status.text).toBe('17 open spots');
    expect(sszorak!.count).toBe(1);

    const battleShout = view.buffs[0]!.rows.find((r) => r.buff.name === 'Battle Shout')!;
    expect(battleShout.cells.map((c) => c.providers)).toEqual([['Ana'], []]);
    // The first boss has the warrior, priest and mage buffs and Heroism; the rest are missing.
    expect(nekzali!.missingBuffs).toBe(9);
    expect(sszorak!.missingBuffs).toBe(12);
  });

  it('saves only sit-outs for raiders in the grid and bosses in the raid', () => {
    const raid = lineupRaids(RAIDS)[0]!;
    const sitouts = toggleSitout(
      new Set([sitoutKey('Sszorak', 1), sitoutKey('Old name', 1), sitoutKey('Sszorak', 4)]),
      "Nek'zali the Soulcoiler",
      2
    );
    expect(sitoutsToSave(sitouts, raid, [1, 2, 3])).toEqual([
      { boss: "Nek'zali the Soulcoiler", player_id: 2 },
      { boss: 'Sszorak', player_id: 1 }
    ]);
    expect(toggleSitout(sitouts, 'Sszorak', 1).has(sitoutKey('Sszorak', 1))).toBe(false);
  });

  it('reads one raid and night from the saved rows', () => {
    const rows: SitoutRow[] = [
      { raid_date: '2026-05-14', raid_name: 'A', boss_name: 'X', player_id: 1 },
      { raid_date: '2026-05-07', raid_name: 'A', boss_name: 'X', player_id: 2 },
      { raid_date: '2026-05-14', raid_name: 'B', boss_name: 'X', player_id: 3 }
    ];
    expect([...sitoutsFor(rows, '2026-05-14', 'A')]).toEqual(['X|1']);
  });

  it('finds last week’s night on the same weekday', () => {
    const nights = [{ date: '2026-05-05' }, { date: '2026-05-07' }, { date: '2026-05-12' }];
    expect(lastWeeksNight(nights, '2026-05-14')).toBe('2026-05-07');
    expect(lastWeeksNight(nights, '2026-05-21')).toBeNull();
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

const SAVED: SitoutRow[] = [
  { raid_date: '2026-05-07', raid_name: 'The Venomous Abyss', boss_name: 'Sszorak', player_id: 3 },
  { raid_date: '2026-05-14', raid_name: 'The Venomous Abyss', boss_name: 'Sszorak', player_id: 1 }
];

function handlers(person: ReturnType<typeof who>, saved = SAVED): FakeHandlers {
  const base = seededHandlers();
  const tables: Record<string, (read: Read) => unknown> = {
    raid_schedule: () =>
      [2, 4].map((weekday) => ({ weekday, start_time: '21:00:00', duration_minutes: 180, is_optional: false })),
    raid_schedule_exceptions: () => [],
    players: () => ROSTER,
    raid_rsvps: () => [],
    boss_lineup_sitouts: () => saved,
    team_settings: () => ({ raids: RAIDS })
  };
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person };
      if (name === 'team_rsvp_answers') return { data: [] };
      if (name === 'set_boss_lineup') return { data: 1 };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table in tables) return { data: tables[read.table]!(read) };
      return base.from!(read);
    }
  });
}

describe('the boss lineup tab', () => {
  it('is not offered to a raider', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup', handlers(who('raider')));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Boss lineup' })).not.toBeInTheDocument();
  });

  it('opens from the night page for an officer', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(who('officer')));
    const tab = await screen.findByRole('link', { name: 'Boss lineup' });
    expect(tab).toHaveAttribute('href', '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup');
    expect(screen.getByRole('link', { name: 'Who’s coming' })).toHaveAttribute('aria-current', 'page');
  });

  it('lets an officer change the lineup and save it', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup', handlers(who('officer')));
    const grid = within(await screen.findByRole('table', { name: 'The Venomous Abyss lineup for Thu, May 14' }));

    const anaSszorak = grid.getByRole('button', { name: 'Ana, Sszorak: sitting out' });
    expect(anaSszorak).toHaveAttribute('aria-pressed', 'false');
    const save = screen.getByRole('button', { name: 'Save lineup' });
    expect(save).toBeDisabled();

    await user.click(grid.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in" }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(save);

    expect(client.rpcs).toContainEqual([
      'set_boss_lineup',
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_raid_name: 'The Venomous Abyss',
        p_sitouts: [
          { boss: "Nek'zali the Soulcoiler", player_id: 2 },
          { boss: 'Sszorak', player_id: 1 }
        ]
      }
    ]);
  });

  it('copies last week’s lineup and puts everyone back in', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup', handlers(who('officer')));
    const grid = within(await screen.findByRole('table', { name: /lineup for/ }));

    await user.click(screen.getByRole('button', { name: 'Copy last Thursday’s lineup' }));
    expect(grid.getByRole('button', { name: 'Cy, Sszorak: sitting out' })).toBeInTheDocument();
    expect(grid.getByRole('button', { name: 'Ana, Sszorak: in' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Everyone in' }));
    expect(grid.queryAllByRole('button', { name: /sitting out/ })).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save lineup' }));
    expect(client.rpcs.find(([name]) => name === 'set_boss_lineup')?.[1]).toMatchObject({ p_sitouts: [] });
  });

  it('switches between the season’s raids', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup', handlers(who('officer')));
    await user.click(await screen.findByRole('button', { name: 'Tidebound Grotto' }));
    expect(await screen.findByText('Tidebound Grotto: up to 25 raiders per boss.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ana, Nymrissa Wavecaller: in' })).toBeInTheDocument();
  });
});
