// The current tier's item level floor per track (#1267), for gear with no
// track bonus id, split out of index.ts so the read can run against a fake
// client (the rows.ts shape).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// season_track_floors rows as the track-to-floor record deriveTrack() grades
// against. A tier with no rows has no floors.
export function floorsFromRows(rows: { track: string; item_level: number }[]): Record<string, number> | null {
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.track, r.item_level]));
}

// No current tier means no floors, which leaves that gear without a track. A
// failed read stops the run, as a failed bonus-id read does: guessed tracks
// are worse than no write.
export async function loadTierFloors(supabase: SupabaseClient<any>): Promise<Record<string, number> | null> {
  const { data: season, error: seasonError } = await supabase.rpc('current_season');
  if (seasonError) throw new Error('Failed to read current_season(): ' + seasonError.message);
  if (!season) return null;
  const { data, error } = await supabase.from('season_track_floors').select('track, item_level').eq('season', season);
  if (error) throw new Error('Failed to load season_track_floors: ' + error.message);
  return floorsFromRows(data || []);
}
