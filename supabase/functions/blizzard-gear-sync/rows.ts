// The rows a sync upserts into player_equipped_gear, split out of index.ts
// so they can be tested without a server (the outcome.ts shape). Every row
// names the team (#944): check_team_id_matches_player() refuses a row whose
// team_id is not the player's, so the caller passes the team it read the
// roster for rather than the row being looked up per player.

export type EquippedRow = {
  player_id: number;
  team_id: number;
  equipment_slot: string;
  wow_item_id: number;
  item_level: number | null;
  track: string | null;
  bonus_list: number[];
  enchantment_id: number | null;
  gem_wow_item_ids: Array<number | null>;
  embellished: boolean;
  crafted: boolean;
  upgrade_rank: number | null;
  upgrade_max: number | null;
};

// A track bonus id's meaning (track_bonus_ids): its track, its step on that
// track, and the track's top step that season (Hero 4 of 6).
export type BonusStep = { track: string; rank: number; max: number };

// track_bonus_ids rows as the lookup buildRows() reads. The top step is
// counted per season and track, since a season could give a track more steps.
export function bonusStepsFromRows(
  rows: Array<{ bonus_id: number; track: string; rank: number; season: string }>
): Map<number, BonusStep> {
  const top = new Map<string, number>();
  for (const r of rows) {
    const key = r.season + '|' + r.track;
    top.set(key, Math.max(top.get(key) ?? 0, r.rank));
  }
  return new Map(
    rows.map((r) => [r.bonus_id, { track: r.track, rank: r.rank, max: top.get(r.season + '|' + r.track)! }])
  );
}

function stepFor(bonusList: number[], bonusTracks: Map<number, BonusStep>): BonusStep | null {
  for (const bonusId of bonusList) {
    const step = bonusTracks.get(bonusId);
    if (step) return step;
  }
  return null;
}

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
  bonusTracks: Map<number, BonusStep>
): string | null {
  const step = stepFor(bonusList, bonusTracks);
  if (step) return step.track;
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
  bonusTracks: Map<number, BonusStep>
): EquippedRow[] {
  const rows: EquippedRow[] = [];
  for (const it of equippedItems) {
    const slot = it?.slot?.type;
    const itemId = it?.item?.id;
    if (!slot || itemId == null) continue;
    const itemLevel = typeof it?.level?.value === 'number' ? it.level.value : null;
    const bonusList = Array.isArray(it?.bonus_list) ? it.bonus_list.filter((b: unknown) => typeof b === 'number') : [];
    const step = stepFor(bonusList, bonusTracks);
    // Only the permanent enchant (#1634): oils, whetstones and Illusory
    // Adornments sit in a TEMPORARY slot and are not enchants.
    const permanent = (Array.isArray(it?.enchantments) ? it.enchantments : []).find(
      (e: any) => e?.enchantment_slot?.type === 'PERMANENT' && typeof e?.enchantment_id === 'number'
    );
    // One entry per socket the item has, null for an empty one. Sockets are
    // read from the item, never assumed from the slot.
    const gems = (Array.isArray(it?.sockets) ? it.sockets : []).map((s: any) =>
      typeof s?.item?.id === 'number' ? s.item.id : null
    );
    // No flag for either in the reply: an embellishment shows as the
    // "Unique-Equipped: Embellished (2)" limit, and crafted gear carries the
    // stats its crafter picked or a "... Crafted" label.
    const embellished = /embellished/i.test(String(it?.limit_category ?? ''));
    const crafted =
      (Array.isArray(it?.modified_crafting_stat) && it.modified_crafting_stat.length > 0) ||
      /crafted/i.test(String(it?.name_description?.display_string ?? ''));
    rows.push({
      player_id: playerId,
      team_id: teamId,
      equipment_slot: slot,
      wow_item_id: itemId,
      item_level: itemLevel,
      track: deriveTrack(itemLevel, thresholds, bonusList, bonusTracks),
      bonus_list: bonusList,
      enchantment_id: permanent ? permanent.enchantment_id : null,
      gem_wow_item_ids: gems,
      embellished,
      crafted,
      upgrade_rank: step ? step.rank : null,
      upgrade_max: step ? step.max : null
    });
  }
  return rows;
}
