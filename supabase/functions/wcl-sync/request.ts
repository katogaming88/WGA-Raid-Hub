// The request body, validated in full before the gate (#1013): which action,
// which team, which zone. Every message here is the exact text the frontend
// shows, so the strings are part of the contract.
export const ACTIONS = [
  'getZoneEncounters',
  'fetchProgression',
  'refreshPerformance',
  'refreshAttendance',
  'fetchSeasonPerf'
] as const;

export type Action = (typeof ACTIONS)[number];

export type ParsedRequest = { action: Action; teamId: number; zoneId: number | null; season: string | null };

export type ParseResult = { ok: true; request: ParsedRequest } | { ok: false; error: string };

const NEEDS_ZONE: ReadonlySet<string> = new Set(['getZoneEncounters', 'fetchProgression', 'fetchSeasonPerf']);

// The frontend sends zoneId: 0 for a blank WCL zone field, so 0 reads as
// absent and keeps its 'Missing zoneId' message rather than becoming invalid.
function absent(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === 0;
}

// A positive integer as a number, or as a string of digits with no leading
// zero. Not parseInt, which reads '1) { name }' as 1.
export function positiveInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return Number(value);
  return null;
}

export function parseRequest(body: unknown): ParseResult {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { action, teamId, zoneId, season } = fields;

  if (!action || absent(teamId)) return { ok: false, error: 'Missing action or teamId' };
  const team = positiveInt(teamId);
  if (team === null) return { ok: false, error: 'Invalid teamId' };
  if (!(ACTIONS as readonly string[]).includes(String(action))) {
    return { ok: false, error: 'Unknown action: ' + action };
  }

  // A zoneId that is present must be an id whatever the action asks for.
  let zone: number | null = null;
  if (!absent(zoneId)) {
    zone = positiveInt(zoneId);
    if (zone === null) return { ok: false, error: 'Invalid zoneId' };
  }
  if (NEEDS_ZONE.has(String(action)) && zone === null) return { ok: false, error: 'Missing zoneId' };

  const seasonCode = typeof season === 'string' && season !== '' ? season : null;
  if (action === 'fetchSeasonPerf' && seasonCode === null) return { ok: false, error: 'Missing season' };

  return { ok: true, request: { action: action as Action, teamId: team, zoneId: zone, season: seasonCode } };
}
