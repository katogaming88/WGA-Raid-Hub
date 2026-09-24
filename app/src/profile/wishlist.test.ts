import { describe, expect, it } from 'vitest';
import type { CatalogItem } from './lootPriority';
import { editorSeason, editorSlots, planMark, type EditorInput, type Pick, type Wearer } from './wishlist';

const item = (id: number, name: string, slot: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name,
  slot,
  wcl_zone_id: 53,
  is_placeholder: false,
  ...extra
});

const catalog = [
  item(1, 'Plate Helm', 'Head', { armor_type: 'Plate' }),
  item(2, 'Cloth Hood', 'Head', { armor_type: 'Cloth' }),
  item(3, 'Old Helm', 'Head', { armor_type: 'Plate', wcl_zone_id: 46 }),
  item(4, 'Ring A', 'Finger'),
  item(5, 'Ring B', 'Finger'),
  item(6, 'Axe', 'One-Hand', { weapon_subtype: 'Axe', main_stats: ['STRENGTH'] }),
  item(7, 'Dagger', 'One-Hand', { weapon_subtype: 'Dagger', main_stats: ['STRENGTH'] }),
  item(8, 'Shield', 'Off Hand', { weapon_subtype: 'Shield' }),
  item(9, 'Healer Trinket', 'Trinket', { name: 'Soulcoiler Ritual Vessel' }),
  item(10, 'Int Trinket', 'Trinket', { main_stats: ['INTELLECT'] }),
  item(11, 'Strength Trinket', 'Trinket', { main_stats: ['STRENGTH'] }),
  item(12, 'Token', 'Hands'),
  item(13, 'Class Gloves', 'Hands', { armor_type: 'Plate' }),
  item(14, 'M+', 'Placeholder', { wcl_zone_id: null, is_placeholder: true })
];

let nextId = 100;
const pick = (item_id: number, status: string, slot: string | null, extra: Partial<Pick> = {}): Pick => ({
  id: nextId++,
  item_id,
  status,
  slot,
  season: 'MID2',
  synced_bis: false,
  ...extra
});

const DEATH_KNIGHT: Wearer = { className: 'Death Knight', spec: 'Frost', role: 'Melee' };

const input = (picks: Pick[], wearer: Wearer = DEATH_KNIGHT): EditorInput => ({
  picks,
  catalog,
  zones: [
    { wcl_zone_id: 53, season: 'MID2' },
    { wcl_zone_id: 46, season: 'MID1' }
  ],
  seasonCode: 'MID2',
  tokens: [
    { token_item_id: 12, resolved_item_id: 13, class: 'Death Knight' },
    { token_item_id: 12, resolved_item_id: 99, class: 'Paladin' }
  ],
  wearer
});

const names = (slots: ReturnType<typeof editorSlots>, slot: string) =>
  slots.find((s) => s.slot === slot)?.items.map((i) => i.name) ?? [];

// The season an officer pinned (Season View, a code since #933) or the team's
// own. One value does both jobs since #936: it scopes the raid items by zone
// and it stamps the row.
describe('editorSeason', () => {
  const team = { name: 'Midnight Season 1', code: 'MID1', start: null, end: null };

  it('takes the pinned Season View', () => {
    expect(editorSeason('MID2', team)).toBe('MID2');
  });

  it('falls back to the team’s season', () => {
    expect(editorSeason(null, team)).toBe('MID1');
  });
});

describe('editorSlots', () => {
  it('offers this season’s raid items the wearer can use', () => {
    const slots = editorSlots(input([]));
    expect(names(slots, 'Head')).toEqual(['Plate Helm']);
    expect(names(slots, 'Hands')).toEqual(['Class Gloves']);
    expect(names(slots, 'Weapon')).toEqual(['Axe']);
    // A dual wielder, who cannot use a shield.
    expect(names(slots, 'Off Hand')).toEqual(['Axe']);
    expect(names(slots, 'Trinket 1')).toEqual(['Strength Trinket']);
    expect(names(slots, 'Finger 2')).toEqual(['Ring A', 'Ring B']);
  });

  it('offers a shield and healer trinkets to a Holy Paladin, and no second one-hander', () => {
    const slots = editorSlots(input([], { className: 'Paladin', spec: 'Holy', role: 'Heal' }));
    expect(names(slots, 'Off Hand')).toEqual(['Shield']);
    expect(names(slots, 'Trinket 1')).toEqual(['Int Trinket', 'Soulcoiler Ritual Vessel']);
  });

  it('offers everything when the wearer’s class is unknown', () => {
    const slots = editorSlots(input([], { className: null, spec: null, role: null }));
    expect(names(slots, 'Head')).toEqual(['Cloth Hood', 'Plate Helm']);
  });

  it('reads a ring BiS in one slot as taken in the other, and a Pass in both', () => {
    const slots = editorSlots(
      input([pick(4, 'bis', 'Finger 1'), pick(4, 'bis', 'Finger 2', { synced_bis: true }), pick(5, 'pass', 'Finger 2')])
    );
    const row = (slot: string, name: string) => slots.find((s) => s.slot === slot)!.items.find((i) => i.name === name);
    expect(row('Finger 1', 'Ring A')).toMatchObject({ mark: 'bis', takenBy: null });
    expect(row('Finger 2', 'Ring A')).toMatchObject({ mark: null, takenBy: 'Finger 1' });
    expect(row('Finger 1', 'Ring B')).toMatchObject({ mark: 'pass' });
    expect(row('Finger 2', 'Ring B')).toMatchObject({ mark: 'pass' });
  });

  it('reads two BiS trinkets saved under one slot as one in each, as six Phoenix raiders have them', () => {
    const first = pick(4, 'bis', 'Finger 1');
    const second = pick(5, 'bis', 'Finger 1');
    const picks = [
      first,
      pick(4, 'bis', 'Finger 2', { synced_bis: true }),
      second,
      pick(5, 'bis', 'Finger 2', { synced_bis: true })
    ];
    const slots = editorSlots(input(picks));
    const row = (slot: string, name: string) => slots.find((s) => s.slot === slot)!.items.find((i) => i.name === name);
    expect(row('Finger 1', 'Ring A')).toMatchObject({ mark: 'bis' });
    expect(row('Finger 1', 'Ring B')).toMatchObject({ mark: null, takenBy: 'Finger 2' });
    expect(row('Finger 2', 'Ring B')).toMatchObject({ mark: 'bis' });
    // Clearing Finger 2's pick unmarks Ring B and its copy, not Ring A.
    expect(plan(picks, 'Finger 2', 5, null).deletes).toEqual([second.id, picks[3]!.id]);
  });

  it('reads old 2nd Choice marks as unmarked, a slotless pick by its item, and an M+ pick for the slot', () => {
    const slots = editorSlots(input([pick(1, 'good', null), pick(6, 'bis', null), pick(14, 'bis', 'Head')]));
    const head = slots.find((s) => s.slot === 'Head')!;
    expect(head.items[0]!.mark).toBeNull();
    expect(head.notFromRaid).toBe('M+');
    expect(slots.find((s) => s.slot === 'Weapon')!.items[0]!.mark).toBe('bis');
    // The slotless axe is a Weapon pick, not an off-hand one.
    expect(slots.find((s) => s.slot === 'Off Hand')!.items[0]!.mark).toBeNull();
  });
});

const plan = (picks: Pick[], row: string, itemId: number, next: 'bis' | 'pass' | null) =>
  planMark({ ...input(picks), teamId: 1, playerId: 11 }, row, itemId, next);

describe('planMark', () => {
  it('saves a new pick with no slot for a one-item slot, as the current site does', () => {
    expect(plan([], 'Head', 1, 'bis')).toEqual({
      deletes: [],
      update: null,
      insert: {
        team_id: 1,
        player_id: 11,
        item_id: 1,
        slot: null,
        status: 'bis',
        note: null,
        season: 'MID2',
        synced_bis: false
      }
    });
  });

  it('unmarks the slot’s other BiS pick and its copy, and a pass on the same ring in the other slot', () => {
    const oldBis = pick(4, 'bis', 'Finger 1');
    const copy = pick(4, 'bis', 'Finger 2', { synced_bis: true });
    const pass = pick(5, 'pass', 'Finger 2');
    const result = plan([oldBis, copy, pass], 'Finger 1', 5, 'bis');
    expect(result.deletes.sort()).toEqual([oldBis.id, copy.id, pass.id].sort());
    expect(result.insert).toMatchObject({ item_id: 5, slot: 'Finger 1', status: 'bis' });
  });

  it('replaces an M+ pick for the slot, but not last season’s raid pick', () => {
    const mplus = pick(14, 'bis', 'Head');
    const old = pick(3, 'bis', null);
    expect(plan([mplus, old], 'Head', 1, 'bis').deletes).toEqual([mplus.id]);
  });

  it('keeps a one-hander BiS in the other hand', () => {
    const offHand = pick(6, 'bis', 'Off Hand');
    expect(plan([offHand], 'Weapon', 6, 'bis').deletes).toEqual([]);
  });

  it('turns an old mark into the new one in place, naming the slot', () => {
    const old = pick(6, 'good', null);
    expect(plan([old], 'Weapon', 6, 'pass')).toEqual({
      deletes: [],
      update: { id: old.id, status: 'pass', slot: 'Weapon' },
      insert: null
    });
  });

  it('clears a mark, with a ring’s copy or a pass saved in the other slot', () => {
    const bis = pick(4, 'bis', 'Finger 1');
    const copy = pick(4, 'bis', 'Finger 2', { synced_bis: true });
    expect(plan([bis, copy], 'Finger 1', 4, null)).toEqual({ deletes: [bis.id, copy.id], update: null, insert: null });
    const pass = pick(5, 'pass', 'Finger 2');
    expect(plan([pass], 'Finger 1', 5, null).deletes).toEqual([pass.id]);
  });
});
