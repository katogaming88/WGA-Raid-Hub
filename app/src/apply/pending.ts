// The application waiting on Discord's consent screen (#1547). Discord sends
// the applicant back to /apply/discord with only a code and a signed state, so
// the page that finishes the join reads which application, and which page to
// land on, from here. Per tab: losing it only means landing on My applications.
const KEY = 'wga-pending-application';

export type Pending = { id: number; path: string };

export function rememberPending(id: number, path: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ id, path }));
  } catch {
    // Storage blocked: the return page falls back to the front page.
  }
}

export function pendingApplication(): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<Pending> | null;
    return typeof p?.id === 'number' && typeof p.path === 'string' && p.path.startsWith('/') ? (p as Pending) : null;
  } catch {
    return null;
  }
}

export function forgetPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored to forget.
  }
}
