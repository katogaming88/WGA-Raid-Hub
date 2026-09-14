// Whether an account is an empty Battle.net sign-in that may be discarded
// (#1101). Kept apart from index.ts so tests/edge can drive it without a stack.

export type Identity = { provider: string };
export type Account = { id: string; identities?: Identity[] | null };

export type Verdict = { ok: true } | { ok: false; reason: string };

// Only one shape qualifies: a Battle.net login and nothing else. That is what a
// raider who already uses Discord gets by pressing Battle.net first on the new
// app. Anything with a Discord identity is a real account, whatever it holds.
//
// Rows are not checked here. Every public table that points at an account
// (team_members, the grant tables, season_signups, audit_log, the dismissal
// tables) refuses the delete through its foreign key, so the database is the
// last word on "nothing is attached"; saved preferences are the one cascade,
// and losing a theme choice is fine.
export function canDiscard(account: Account | null): Verdict {
  if (!account) return { ok: false, reason: 'Not signed in' };
  const providers = (account.identities ?? []).map((i) => i.provider);
  if (providers.length !== 1 || providers[0] !== 'custom:battlenet') {
    return { ok: false, reason: 'Only a Battle.net-only sign-in can be discarded' };
  }
  return { ok: true };
}

// A delete the database refused because something points at the account.
export function isStillReferenced(message: string | undefined): boolean {
  return /foreign key|violates|still referenced/i.test(message ?? '');
}
