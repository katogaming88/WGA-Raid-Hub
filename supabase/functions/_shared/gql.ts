// GraphQL literals for the WarcraftLogs queries (#1013). Query text is built
// by interpolation in wcl-sync and wcl-progression-sync; every value that
// comes from a request, a row or a WCL payload goes through one of these,
// so a string cannot close its own quotes and an int slot never holds text.
// The signatures make deno check refuse a string in an int slot; the runtime
// checks cover the any-typed values supabase-js and WCL hand back.

// GraphQL's string grammar is JSON's, escapes included.
export function gqlString(value: string): string {
  if (typeof value !== 'string') throw new Error('GraphQL string expected');
  return JSON.stringify(value);
}

export function gqlInt(value: number): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('GraphQL int expected');
  return String(value);
}
