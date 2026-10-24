import { nameRealmKey } from '../characters/characters';
import { CLASS_SPECS, SPEC_ROLE } from './wowData';

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
  notes: string;
  backupTank: boolean;
  backupHealer: boolean;
};

// The backup ticks to offer (#1466), as declare_season_signup() stores them
// (#1622): a role one of the class's specs plays, and not the one the main
// spec plays (a main tank is not a backup tank). Nothing until a main spec is
// picked.
export function backupRolesFor(className: string, mainSpec: string): ('Tank' | 'Heal')[] {
  const specs = CLASS_SPECS[className]?.specs;
  if (!specs || !mainSpec) return [];
  return (['Tank', 'Heal'] as const).filter((r) => SPEC_ROLE[mainSpec] !== r && specs.some((s) => SPEC_ROLE[s] === r));
}

// Said on the form and the summary (Kat, 2026-10-24): a signup is not final
// until signups close.
export const CHANGE_UNTIL_CLOSE =
  'You can change your signup to a different character, class or spec any time until officers close signups, or until they close by themselves when the season starts.';
