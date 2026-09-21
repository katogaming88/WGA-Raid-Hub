import * as Sentry from '@sentry/browser';
import { errorMessage, setErrorReporter } from './errors';

// Hosted error reporting (#1161). Plugs into reportError(), the one place a
// failure is reported from, so the shell's reads and writes need no changes.
// It runs only where a DSN is set: production and preview builds, not local
// development (.env.production, like the Supabase target, #1057).

// An address without its query or fragment. A sign-in return carries a code or
// token there, and a query can hold a search, so neither goes to Sentry.
export function scrubUrl(url: string): string {
  return url.split(/[?#]/)[0] ?? '';
}

// Only the page address, never who or what: no cookies, no request headers
// (the Referer would carry the query), no email. The account id is set apart,
// by setReportUser().
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
  }
  return event;
}

export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = crumb.data;
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = scrubUrl(data[key]);
    }
  }
  return crumb;
}

// Returns whether reporting is on. No DSN, nothing changes: failures keep
// going to the console only.
export function initSentry(dsn: unknown, environment: string): boolean {
  if (typeof dsn !== 'string' || !dsn) return false;
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb
  });
  setErrorReporter((error, context) => {
    console.error(`[${context.where}]`, error, context.key ?? '');
    // A failed read is often a plain object, which Sentry cannot give a stack.
    const err = error instanceof Error ? error : new Error(errorMessage(error));
    Sentry.captureException(err, {
      tags: { where: context.where, ...(typeof context.key?.[0] === 'string' ? { read: context.key[0] } : {}) }
    });
  });
  return true;
}

// The signed-in account id, and nothing else about them, so a report can be
// followed up. Signed out clears it.
export function setReportUser(id: string | null): void {
  Sentry.setUser(id ? { id } : null);
}
