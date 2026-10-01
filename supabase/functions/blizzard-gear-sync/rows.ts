// The rows a sync upserts into player_equipped_gear, split out of index.ts
// so they can be tested without a server (the outcome.ts shape). Every row
// names the team (#944): check_team_id_matches_player() refuses a row whose
// team_id is not the player's, so the caller passes the team it read the
// roster for rather than the row being looked up per player.

export type EquippedRow = {
  player_id: number;
  team_id: number;
  equipment_slot: string;
  item_id: number;
  item_level: number | null;
  track: string | null;
  bonus_list: number[];
};

const TRACKS_HIGH_TO_LOW = ['Myth', 'Hero', 'Champion', 'Veteran', 'Adventurer', 'Explorer'] as const;

// Item level is a fallback only, for gear that carries no track bonus ID at
// all -- crafted, Timewarped and similar, roughly a fifth of a real roster's
// items. It cannot distinguish overlapping tracks and will read a
// fully-upgraded Hero item as Myth, so it must never take precedence over a
// bonus ID that did resolve.
export function deriveTrack(
  itemLevel: number | null,
  thresholds: Record<string, number> | null,
  bonusList: number[],
  bonusTracks: Map<number, string>
): string | null {
  for (const bonusId of bonusList) {
    const track = bonusTracks.get(bonusId);
    if (track) return track;
  }
  if (itemLevel == null || !thresholds) return null;
  for (const track of TRACKS_HIGH_TO_LOW) {
    const floor = thresholds[track];
    if (typeof floor === 'number' && itemLevel >= floor) return track;
  }
  return null;
}

export function buildRows(
  playerId: number,
  teamId: number,
  equippedItems: any[],
  thresholds: Record<string, number> | null,
  bonusTracks: Map<number, string>
): EquippedRow[] {
  const rows: EquippedRow[] = [];
  for (const it of equippedItems) {
    const slot = it?.slot?.type;
    const itemId = it?.item?.id;
    if (!slot || itemId == null) continue;
    const itemLevel = typeof it?.level?.value === 'number' ? it.level.value : null;
    const bonusList = Array.isArray(it?.bonus_list) ? it.bonus_list.filter((b: unknown) => typeof b === 'number') : [];
    rows.push({
      player_id: playerId,
      team_id: teamId,
      equipment_slot: slot,
      item_id: itemId,
      item_level: itemLevel,
      track: deriveTrack(itemLevel, thresholds, bonusList, bonusTracks),
      bonus_list: bonusList
    });
  }
  return rows;
}
