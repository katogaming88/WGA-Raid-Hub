// The one place a failure is reported from (#1101). Every failed read or
// write passes through here as well as being shown on the page, so nothing
// fails silently. It logs to the console; where a Sentry DSN is set,
// lib/sentry.ts swaps in a reporter that also sends it there (#1161).

export type ErrorContext = { where: string; key?: readonly unknown[] };

type Reporter = (error: unknown, context: ErrorContext) => void;

const consoleReporter: Reporter = (error, context) => {
  console.error(`[${context.where}]`, error, context.key ?? '');
};

let reporter: Reporter = consoleReporter;

export function reportError(error: unknown, context: ErrorContext): void {
  try {
    reporter(error, context);
  } catch {
    // A broken reporter must never take the page down with it.
  }
}

// Tests swap the reporter to assert that a failure was reported.
export function setErrorReporter(next: Reporter | null): void {
  reporter = next ?? consoleReporter;
}

// A readable message for the error box, whatever shape the failure took.
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Something went wrong.';
}
