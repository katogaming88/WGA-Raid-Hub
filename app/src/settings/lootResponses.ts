import { isOffSpec } from '../home/home';

// What gets counted as loot received (#1561): the team's RCLootCouncil
// response buttons, as spelled in game and in the in-game order, and what an
// award under each one counts as. Saved by set_loot_responses() on
// team_settings.config.lootResponses. Matched to an award by its response
// text, ignoring case and outer spaces ("Track upgrade" and "Track Upgrade"
// are one button).

export type CountsAs = 'main' | 'off' | 'none' | 'hidden';
export type ResponseButton = { text: string; countsAs: CountsAs };
export type ButtonGroup = { name: string; buttons: ResponseButton[] };
// Once a list is saved, a response it does not name counts as Hidden (Kat,
// 2026-10-19), so leaving a response off the list is how an officer hides it.
export type ResponseList = { buttons: ResponseButton[]; groups: ButtonGroup[] };
export type SeenResponse = { text: string; count: number };

export const COUNTS_AS: { id: CountsAs; label: string }[] = [
  { id: 'main', label: 'Main spec' },
  { id: 'off', label: 'Off spec' },
  { id: 'none', label: 'Not handed out' },
  { id: 'hidden', label: 'Hidden' }
];

// RCLootCouncil's per-item-type button groups the card offers.
export const GROUP_NAMES = ['Armor Token', 'Weapon', 'Trinket', 'Ring', 'Necklace'];

// Recorded by RCLootCouncil on its own, not buttons: always Not handed out.
export const FIXED_RESPONSES = ['Personal Loot - Non tradeable', 'Disenchant'];

export const responseKey = (text: string) => text.trim().toLowerCase();
const isFixed = (text: string) => FIXED_RESPONSES.some((f) => responseKey(f) === responseKey(text));

// What a response counts as with no list saved: today's rules (#1584 and
// isOffSpec()), so nothing moves until an officer saves a list.
export function todaysCountsAs(text: string): CountsAs {
  const key = responseKey(text);
  if (key === 'xmog' || key === 'pet') return 'hidden';
  if (key === 'bonus loot' || isFixed(text)) return 'none';
  return isOffSpec(text) ? 'off' : 'main';
}

// What one award counts as under its team's list (null: none saved, today's
// rules). An award with no response (older imports) counts as Main spec.
export function awardCountsAs(list: ResponseList | null, response: string | null | undefined): CountsAs {
  if (!response?.trim()) return 'main';
  if (!list) return todaysCountsAs(response);
  if (isFixed(response)) return 'none';
  const key = responseKey(response);
  const button = [...list.buttons, ...list.groups.flatMap((g) => g.buttons)].find((b) => responseKey(b.text) === key);
  return button?.countsAs ?? 'hidden';
}

// `offSpec`: tagged Off spec. `counted`: counts toward items received. With no
// list saved an off-spec win still counts there, as today (only the home feed
// and Suggest order leave it out).
export type CountedLoot = { offSpec: boolean; counted: boolean };

// The awards shown anywhere (Main spec and Off spec), each marked. Not handed
// out and Hidden are dropped. `lists` is keyed by each award's team.
export function shownLoot<T extends { team_id: number | null; response: string | null }>(
  rows: T[],
  lists: Map<number, ResponseList | null>
): (T & CountedLoot)[] {
  const out: (T & CountedLoot)[] = [];
  for (const row of rows) {
    const list = (row.team_id !== null && lists.get(row.team_id)) || null;
    const countsAs = awardCountsAs(list, row.response);
    if (countsAs !== 'main' && countsAs !== 'off') continue;
    out.push({ ...row, offSpec: countsAs === 'off', counted: countsAs === 'main' || !list });
  }
  return out;
}

const isCountsAs = (value: unknown): value is CountsAs => COUNTS_AS.some((c) => c.id === value);

function asButtons(raw: unknown): ResponseButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is ResponseButton => typeof b?.text === 'string' && isCountsAs(b?.countsAs))
    .map((b) => ({ text: b.text, countsAs: b.countsAs }));
}

// The saved list, or null when the team never saved one.
export function asResponseList(raw: unknown): ResponseList | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = raw as { buttons?: unknown; groups?: unknown };
  return {
    buttons: asButtons(list.buttons),
    groups: Array.isArray(list.groups)
      ? list.groups
          .filter((g): g is { name: string; buttons: unknown } => typeof g?.name === 'string')
          .map((g) => ({ name: g.name, buttons: asButtons(g.buttons) }))
      : []
  };
}

// Every response the team's imports used, with how often: one entry per
// button, spelled the way it was used most. Awards with no response (older
// imports) are not a button and are left out.
export function seenResponses(responses: (string | null)[]): SeenResponse[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const r of responses) {
    if (!r || !r.trim()) continue;
    const spellings = byKey.get(responseKey(r)) ?? new Map<string, number>();
    spellings.set(r.trim(), (spellings.get(r.trim()) ?? 0) + 1);
    byKey.set(responseKey(r), spellings);
  }
  return [...byKey.values()]
    .map((spellings) => {
      const [text] = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]!;
      return { text, count: [...spellings.values()].reduce((sum, n) => sum + n, 0) };
    })
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

// A first list for a team that never saved one: every button its imports
// used, most used first, each counted the way it is today.
export function draftFromSeen(seen: SeenResponse[]): ResponseList {
  return {
    buttons: seen.filter((s) => !isFixed(s.text)).map((s) => ({ text: s.text, countsAs: todaysCountsAs(s.text) })),
    groups: []
  };
}

export function timesUsed(seen: SeenResponse[], text: string): number {
  return seen.find((s) => responseKey(s.text) === responseKey(text))?.count ?? 0;
}

// Responses the imports used that the list does not name: they count as
// Hidden, and the card offers them to add. A removed row comes back here.
export function unlistedResponses(list: ResponseList, seen: SeenResponse[]): SeenResponse[] {
  const listed = new Set([...list.buttons, ...list.groups.flatMap((g) => g.buttons)].map((b) => responseKey(b.text)));
  return seen.filter((s) => !isFixed(s.text) && !listed.has(responseKey(s.text)));
}

// Moves the item at `from` one place up or down, as the in-game order.
export function moveItem<T>(items: T[], from: number, step: -1 | 1): T[] {
  const to = from + step;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
