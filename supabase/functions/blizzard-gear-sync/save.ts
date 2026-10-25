// Saves one character's gear, split out of index.ts so it can be tested
// without a server (the rows.ts shape). Blizzard's reply is the whole of
// what they wear, so after the upsert any other slot on file for them is
// removed (#1628): an off hand dropped for a two-hander would otherwise stay
// "worn" and keep them off that off hand's priority list. The removal only
// runs once the upsert worked and the reply named at least one slot, so a
// failed or empty reply never wipes their gear.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { EquippedRow } from './rows.ts';

// The error message, or null when the save went through.
export async function saveGear(
  supabase: SupabaseClient<any>,
  playerId: number,
  rows: Array<EquippedRow & { synced_at?: string }>
): Promise<string | null> {
  if (rows.length === 0) return null;

  const { error: upsertError } = await supabase
    .from('player_equipped_gear')
    .upsert(rows, { onConflict: 'player_id,equipment_slot' });
  if (upsertError) return upsertError.message;

  const slots = rows.map((r) => '"' + r.equipment_slot + '"').join(',');
  const { error: deleteError } = await supabase
    .from('player_equipped_gear')
    .delete()
    .eq('player_id', playerId)
    .not('equipment_slot', 'in', '(' + slots + ')');
  return deleteError ? deleteError.message : null;
}
