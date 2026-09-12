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

export function positiveInt(_value: unknown): number | null {
  throw new Error('unbuilt');
}

export function parseRequest(_body: unknown): ParseResult {
  throw new Error('unbuilt');
}
