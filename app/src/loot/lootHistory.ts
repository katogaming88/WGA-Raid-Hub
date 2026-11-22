import { easternDate } from '../lib/dates';

// Loot history (#814): a team's whole rclc_loot log, counted. No player on
// purpose (#279): the page counts items per team, never items per raider.

export type HistoryDrop = {
  id: number;
  team_id: number;
  track: string | null;
  season: string | null;
  awarded_at: string;
  boss: string | null;
  response: string | null;
  item_id: number | null;
  items: {
    name: string;
    slot: string;
    armor_type: string | null;
    wow_item_id: number | null;
    is_ptr: boolean;
    icon: string | null;
  } | null;
};

// 'tokens' is every tier token; an armor type is that armor's tokens.
export type TokenFamily = '' | 'tokens' | 'Cloth' | 'Leather' | 'Mail' | 'Plate';

export type HistoryFilters = {
  item: string;
  family: TokenFamily;
  season: string;
  track: string;
  boss: string;
  slot: string;
  armor: string;
  from: string;
  to: string;
};

export const NO_FILTERS: HistoryFilters = {
  item: '',
  family: '',
  season: '',
  track: '',
  boss: '',
  slot: '',
  armor: '',
  from: '',
  to: ''
};

export const itemName = (d: HistoryDrop) => d.items?.name ?? 'Unknown item';

export function filterDrops(drops: HistoryDrop[], f: HistoryFilters, tokenIds: Set<number>): HistoryDrop[] {
  const needle = f.item.trim().toLowerCase();
  return drops.filter((d) => {
    if (needle && !itemName(d).toLowerCase().includes(needle)) return false;
    if (f.family) {
      if (d.item_id === null || !tokenIds.has(d.item_id)) return false;
      if (f.family !== 'tokens' && d.items?.armor_type !== f.family) return false;
    }
    if (f.season && d.season !== f.season) return false;
    if (f.track && d.track !== f.track) return false;
    if (f.boss && d.boss !== f.boss) return false;
    if (f.slot && d.items?.slot !== f.slot) return false;
    if (f.armor && d.items?.armor_type !== f.armor) return false;
    if (f.from || f.to) {
      const day = easternDate(d.awarded_at);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    return true;
  });
}

// `sample` is one of the group's drops, for the item's Wowhead link.
export type Rollup = { key: string; count: number; last: string; sample: HistoryDrop };

// One row per item, boss or season, with how many dropped and the latest one.
export function rollup(drops: HistoryDrop[], by: (d: HistoryDrop) => string): Rollup[] {
  const groups = new Map<string, Rollup>();
  for (const d of drops) {
    const key = by(d);
    const g = groups.get(key);
    if (!g) groups.set(key, { key, count: 1, last: d.awarded_at, sample: d });
    else {
      g.count++;
      if (d.awarded_at > g.last) g.last = d.awarded_at;
    }
  }
  return [...groups.values()];
}

// The choices each filter offers, from the log itself.
export function choices(drops: HistoryDrop[], pick: (d: HistoryDrop) => string | null | undefined): string[] {
  return [...new Set(drops.map(pick).filter((v): v is string => !!v))].sort();
}
