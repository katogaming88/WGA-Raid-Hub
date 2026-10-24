import { nameRealmKey } from '../characters/characters';
import { resolveRole } from './wowData';

// The Sign Up form's rules (#1102), ported from js/signup.js and recorded
// against it in tests/behavior/signup.js. Kept apart from the component so
// they are tested without rendering.

export type ClassmateRow = { nameRealm: string; class: string | null; spec: string | null; role: string | null };
export type IncomingSignupRow = ClassmateRow & { swapFromNameRealm: string | null };

// Who counts as "already playing this class" and "already signed up as this
// role" (#499): the approved incoming roster always, plus the confirmed
// active roster too, but ONLY when the team's live season already equals the
// signup tier -- see js/signup.js's signupClassmatesPool() for the full
// reasoning (Hellfire pushes approvals straight onto the roster; Phoenix
// keeps raiding a prior season while collecting next tier's signups).
export function classmatesPool(
  incoming: IncomingSignupRow[],
  roster: ClassmateRow[],
  liveSeasonCode: string | null,
  signupSeasonCode: string
): ClassmateRow[] {
  if (!liveSeasonCode || liveSeasonCode !== signupSeasonCode) return incoming;
  const swappedFrom = new Set(
    incoming.flatMap((r) => (r.swapFromNameRealm ? [r.swapFromNameRealm.toLowerCase()] : []))
  );
  const byKey = new Map<string, ClassmateRow>();
  for (const p of roster) {
    const key = p.nameRealm.toLowerCase();
    if (swappedFrom.has(key)) continue;
    byKey.set(key, p);
  }
  for (const p of incoming) byKey.set(p.nameRealm.toLowerCase(), p);
  return [...byKey.values()];
}

// What a pick means (#1466), decided as declare_season_signup() decides it:
// a pick that is one of their characters on this team's roster is the same
// main, even when they have two there; any other pick replaces their earliest
// roster character (lowest player id); with none, it is their first main on
// the team. Shown before they submit, so there is no swap box to get wrong.
export type PickReading = { kind: 'same' } | { kind: 'new'; replaces: string } | { kind: 'first' };

export function readPick(pickNameRealm: string, roster: { playerId: number; nameRealm: string }[]): PickReading {
  const pick = nameRealmKey(pickNameRealm);
  if (roster.some((r) => nameRealmKey(r.nameRealm) === pick)) return { kind: 'same' };
  const earliest = [...roster].sort((a, b) => a.playerId - b.playerId)[0];
  return earliest ? { kind: 'new', replaces: earliest.nameRealm } : { kind: 'first' };
}

export const readingLabel = (reading: PickReading): string =>
  reading.kind === 'same'
    ? 'Same main as now'
    : reading.kind === 'new'
      ? `New main: replaces ${reading.replaces}`
      : 'First main on this team';

export type SignupFields = {
  characterId: number | null;
  className: string;
  mainSpec: string;
  offSpecs: string[];
  primaryRole: string | null;
  notes: string;
};

export const role = (className: string, mainSpec: string, primaryRole: string | null) =>
  resolveRole(className, mainSpec, primaryRole);
