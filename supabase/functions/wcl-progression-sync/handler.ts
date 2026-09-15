// wcl-progression-sync handler (#932): the shape tests/edge/ runs against.
// The behaviour lives in index.ts until the split lands; this stub is the
// red step's subject.
export type Env = { get(name: string): string | undefined };

export type SeasonRow = { code: string; display_name: string };
export type TeamRow = { id: number; wcl_guild_id: number };
export type RaidZoneRow = {
  wcl_zone_id: number;
  name: string;
  season: string;
  is_mini_raid: boolean;
  sort_index: number;
};
export type EncounterRow = { zone_id: number; wcl_encounter_id: number; name: string; sort_index: number };
export type SavedEncounter = { id: number; wcl_encounter_id: number };
export type ProgressRow = Record<string, unknown>;

// One method per read or write the function performs. Production implements
// it over supabase-js in deps.ts; a test hands in a plain object.
export interface ProgressDb {
  currentSeason(): Promise<SeasonRow[]>;
  teams(): Promise<TeamRow[]>;
  teamConfig(teamId: number): Promise<Record<string, unknown>>;
  upsertRaidZone(row: RaidZoneRow): Promise<number>;
  upsertEncounters(rows: EncounterRow[]): Promise<SavedEncounter[]>;
  upsertProgress(rows: ProgressRow[]): Promise<void>;
}

export type Deps = { fetch: typeof fetch; env: Env; db: ProgressDb };

export function handle(_req: Request, _deps: Deps): Promise<Response> {
  return Promise.reject(new Error('unbuilt'));
}
