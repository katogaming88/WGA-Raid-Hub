// GraphQL literals for the WarcraftLogs queries (#1013). Query text is built
// by interpolation in wcl-sync and wcl-progression-sync; every value that
// comes from a request, a row or a WCL payload goes through one of these,
// so a string cannot close its own quotes and an int slot never holds text.
export function gqlString(_value: string): string {
  throw new Error('unbuilt');
}

export function gqlInt(_value: number): string {
  throw new Error('unbuilt');
}
