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

// The realm list a click-to-browse, type-to-filter combobox shows: the whole
// list with nothing typed (so it still works as a plain dropdown), a
// substring match once there is a query.
export function realmOptions(realms: string[], query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return realms;
  return realms.filter((r) => r.toLowerCase().includes(q));
}

// Whether the typed character differs from the one this person already has
// on this team's roster (their "claim") -- the only case that can become a
// main swap. No claim at all means nothing to compare against.
export function claimDiffers(claimNameRealm: string | null, charName: string, realm: string): boolean {
  if (!claimNameRealm || !charName || !realm) return false;
  return `${charName}-${realm}`.toLowerCase() !== claimNameRealm.toLowerCase();
}

// A character's class never changes, so picking a class that does not match
// the claimed character's own class on the roster is usually a wrong click,
// not an intentional swap (a real swap changes the character, not just the
// class on the same one) -- only checked when the typed name still matches
// the claim.
export function classMismatch(
  claimedClass: string | null,
  claimNameRealm: string | null,
  charName: string,
  realm: string,
  pickedClass: string | null
): boolean {
  if (!pickedClass || !claimedClass || !claimNameRealm) return false;
  if (claimDiffers(claimNameRealm, charName, realm)) return false;
  return claimedClass !== pickedClass;
}

export type SignupFields = {
  charName: string;
  realm: string;
  className: string;
  mainSpec: string;
  offSpecs: string[];
  primaryRole: string | null;
  notes: string;
};

export type SignupSubmission = {
  p_name_realm: string;
  p_class: string;
  p_spec: string;
  p_off_specs: string;
  p_main_swap: boolean;
  p_player_note: string;
  p_swap_from_name_realm: string | null;
};

// What submit_season_signup/update_own_signup take, built from the form and
// whether this submission is a swap (the typed name differs from the claim,
// already confirmed by the raider on step 1).
export function buildSubmission(
  fields: SignupFields,
  isSwap: boolean,
  claimNameRealm: string | null
): SignupSubmission {
  return {
    p_name_realm: `${fields.charName}-${fields.realm}`,
    p_class: fields.className,
    p_spec: fields.mainSpec,
    p_off_specs: fields.offSpecs.join(', '),
    p_main_swap: isSwap,
    p_player_note: fields.notes,
    p_swap_from_name_realm: isSwap ? claimNameRealm : null
  };
}

export const role = (className: string, mainSpec: string, primaryRole: string | null) =>
  resolveRole(className, mainSpec, primaryRole);
