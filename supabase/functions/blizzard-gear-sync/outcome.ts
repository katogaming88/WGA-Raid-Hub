// The record a sweep leaves on site_settings (#1174), split out of index.ts
// so it can be tested without a server (the contact-webhook/format.ts shape).
// The row is public-read, so an error is stored as its message alone.

export type Trigger = 'cron' | 'officer';

export type Tally = {
  synced: number;
  skipped: number;
  teams: number;
  players: number;
  error: string | null;
};

export type RunOutcome = Tally & {
  trigger: Trigger;
  started_at: string;
  finished_at: string;
};

export const ERROR_MAX = 300;

// Each trigger keeps its own column on site_settings, so an officer's sync
// cannot refresh the scheduled sweep's age.
export function columnFor(trigger: Trigger): 'gear_sync_last_cron_run' | 'gear_sync_last_officer_run' {
  return trigger === 'cron' ? 'gear_sync_last_cron_run' : 'gear_sync_last_officer_run';
}

export function newTally(): Tally {
  return { synced: 0, skipped: 0, teams: 0, players: 0, error: null };
}

// Keeps the first error of a run; the later ones are usually the same one.
export function noteError(tally: Tally, err: unknown): void {
  if (tally.error !== null) return;
  const message = err instanceof Error ? err.message : String(err);
  tally.error = message.length > ERROR_MAX ? message.slice(0, ERROR_MAX) : message;
}

export function buildOutcome(trigger: Trigger, startedAt: Date, finishedAt: Date, tally: Tally): RunOutcome {
  return {
    trigger,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    synced: tally.synced,
    skipped: tally.skipped,
    teams: tally.teams,
    players: tally.players,
    error: tally.error
  };
}
