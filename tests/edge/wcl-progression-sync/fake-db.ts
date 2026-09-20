// The injected database of wcl-progression-sync (#932): an in-memory
// ProgressDb with a call log, so a test can assert what was written and
// that nothing was written before a refusal.
import type {
  EncounterRow,
  ProgressDb,
  ProgressRow,
  RaidZoneRow,
  SavedEncounter,
  TeamRow
} from '../../../supabase/functions/wcl-progression-sync/handler.ts';

export type FakeDbState = {
  teams?: TeamRow[];
  configs?: Record<number, Record<string, unknown>>;
  // The tier current_season() answers with; MID2 unless a test says otherwise.
  currentSeason?: string | null;
  // Zones already in raid_zones, by wcl_zone_id, with the season each is filed under.
  zones?: Record<number, string>;
};

export type DbCall = { method: keyof ProgressDb; args: unknown[] };

export type FakeDb = ProgressDb & { calls: DbCall[] };

export function fakeDb(state: FakeDbState = {}): FakeDb {
  const calls: DbCall[] = [];
  const record = (method: keyof ProgressDb, ...args: unknown[]) => calls.push({ method, args });
  // raid_zones ids are minted in order, from 900, and encounters from 500.
  let nextZoneId = 900;
  let nextEncounterId = 500;
  return {
    calls,
    teams() {
      record('teams');
      return Promise.resolve(state.teams ?? []);
    },
    teamConfig(teamId) {
      record('teamConfig', teamId);
      return Promise.resolve(state.configs?.[teamId] ?? {});
    },
    currentSeason() {
      record('currentSeason');
      return Promise.resolve(state.currentSeason === undefined ? 'MID2' : state.currentSeason);
    },
    raidZoneSeason(wclZoneId: number) {
      record('raidZoneSeason', wclZoneId);
      return Promise.resolve(state.zones?.[wclZoneId] ?? null);
    },
    upsertRaidZone(row: RaidZoneRow) {
      record('upsertRaidZone', row);
      return Promise.resolve(nextZoneId++);
    },
    upsertEncounters(rows: EncounterRow[]) {
      record('upsertEncounters', rows);
      return Promise.resolve(
        rows.map((r): SavedEncounter => ({ id: nextEncounterId++, wcl_encounter_id: r.wcl_encounter_id }))
      );
    },
    upsertProgress(rows: ProgressRow[]) {
      record('upsertProgress', rows);
      return Promise.resolve();
    }
  };
}
