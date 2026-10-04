// The any-time main swap request (#631, #942 step 5c): a raider asks to raid
// on one of their alts instead, and an officer approves it. The rules live
// here so they are tested without rendering.
//
// Kat's calls (2026-09-16):
// - The ask is made from the Characters card, with a character already listed
//   as an alt, so Blizzard's own list is the proof they own it.
// - Officers review it on the roster, where they already look at the team.
// - Approving keeps today's behaviour: the old character leaves the roster and
//   keeps its history. The "Main tick" idea (#631) waits until cutover.

import { nameRealmKey } from './characters';

export type SwapStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export type SwapRequest = {
  id: number;
  team_id: number;
  person_id: number;
  from_player_id: number;
  character_id: number | null;
  name_realm: string;
  class_spec_id: number | null;
  note: string | null;
  status: SwapStatus;
  requested_at: string;
  officer_note: string | null;
};

// A request with what an officer needs to read it: who they are on now, and
// the spec they are asking to raid.
export type ReviewRow = SwapRequest & {
  from_player: { name_realm: string } | null;
  classes_specs: { class: string; spec: string; role: string | null } | null;
};

export type ClassSpec = { id: number; class: string; spec: string; role: string | null };

// The specs a character could raid as: its own class's, in spec order. An
// unknown class (Blizzard's list had no class for it) offers none, and the
// dialog says to choose alts again rather than guessing.
export const specsFor = (specs: ClassSpec[], className: string | null): ClassSpec[] =>
  className === null ? [] : specs.filter((s) => s.class === className).sort((a, b) => a.spec.localeCompare(b.spec));

export const specLabel = (spec: { class: string; spec: string } | null): string =>
  spec ? `${spec.spec} ${spec.class}` : 'Spec not recorded';

// "Grihzold-Illidan" reads as "Grihzold" everywhere a row already says which
// realm it is on.
export const characterName = (nameRealm: string): string => nameRealm.split('-')[0]!.trim();

const DAY = 24 * 60 * 60 * 1000;

// How long an officer has left it waiting. Whole days, counted from when it
// was asked, so "asked today" covers everything under a day.
export function askedAgo(requestedAt: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(requestedAt).getTime()) / DAY);
  if (!Number.isFinite(days) || days <= 0) return 'asked today';
  if (days === 1) return 'asked yesterday';
  return `asked ${days} days ago`;
}

// One line an officer can read at a glance: who moves where, and as what.
export const swapLine = (row: ReviewRow): string =>
  `${characterName(row.from_player?.name_realm ?? 'Their character')} to ${row.name_realm}, ${specLabel(
    row.classes_specs
  )}`;

// Whether the Characters card offers an alt the ask. One request at a time per
// team, so while one is waiting the others only say why they cannot be asked
// for.
// An alt an officer declined says so, with the officer's note, since the
// database refuses that alt again (#1430). Matched by name key, as it does.
export type AltAsk =
  { kind: 'ask' } | { kind: 'waiting' } | { kind: 'declined'; note: string | null } | { kind: 'blocked' };

export function altAsk(pending: SwapRequest | null, altNameRealm: string, declined: SwapRequest[] = []): AltAsk {
  const key = nameRealmKey(altNameRealm);
  if (pending !== null && nameRealmKey(pending.name_realm) === key) return { kind: 'waiting' };
  const decline = declined.find((r) => nameRealmKey(r.name_realm) === key);
  if (decline) return { kind: 'declined', note: decline.officer_note };
  return pending === null ? { kind: 'ask' } : { kind: 'blocked' };
}

// The raider's own requests on a team, as the Characters card reads them: the
// one waiting, if any, and every one an officer declined.
export type MySwaps = { pending: SwapRequest | null; declined: SwapRequest[] };

export const splitMine = (rows: SwapRequest[]): MySwaps => ({
  pending: rows.find((r) => r.status === 'pending') ?? null,
  declined: rows.filter((r) => r.status === 'declined')
});
