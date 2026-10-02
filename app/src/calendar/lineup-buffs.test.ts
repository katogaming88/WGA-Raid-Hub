import { describe, expect, it, vi } from 'vitest';
import type { PlayerRow } from '../roster/roster';
import type { RaidNight } from './calendar';
import { lineupView, placesOf, type LineupRaid } from './lineup';

// The lineup checks whatever the one buff list says (#1244). Here the list
// holds only Mass Grip, which a death knight brings only as Blood, so a change
// to the list, spec rule included, has to reach the grid.
vi.mock('../roster/buffs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../roster/buffs')>()),
  LINEUP_BUFFS: [{ name: 'Mass Grip', group: 'utility', classes: ['Death Knight'], specs: ['Blood'], spellId: 108199 }]
}));

const dk = (id: number, name: string, spec: string): PlayerRow => ({
  id,
  name_realm: `${name}-Illidan`,
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: { class: 'Death Knight', spec, role: 'Tank' }
});

const NIGHT: RaidNight = {
  date: '2026-05-14',
  start: '21:00:00',
  durationMinutes: 180,
  optional: false,
  extra: false,
  note: ''
};

const RAID: LineupRaid = {
  zoneId: 1,
  name: 'R',
  cap: 1,
  bosses: [
    { id: 1, name: 'A', short: 'A', skipped: false, confirmed: false, cap: 1 },
    { id: 2, name: 'B', short: 'B', skipped: false, confirmed: false, cap: 1 }
  ]
};

describe('the lineup’s buff check', () => {
  it('follows the buff list, counting a spec-only buff for that spec alone', () => {
    const tonight = placesOf([
      { encounter_id: 1, player_id: 1 },
      { encounter_id: 2, player_id: 2 }
    ]);
    const view = lineupView([dk(1, 'Bloodgar', 'Blood'), dk(2, 'Frostin', 'Frost')], NIGHT, [], RAID, tonight, tonight);
    expect(view.buffs.map((r) => r.buff.name)).toEqual(['Mass Grip']);
    expect(view.buffs[0]!.cells.map((c) => c.providers)).toEqual([['Bloodgar'], []]);
    expect(view.totals.map((t) => t.missing)).toEqual([[], ['Mass Grip']]);
  });
});
