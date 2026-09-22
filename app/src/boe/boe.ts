// Report a BoE find (#1304): the guild-wide card ported from the current
// site's js/boe.js, at /g/:guildKey/boe. Pure logic split from BoeReportForm
// the same way as history.ts/guild.ts; recorded against
// tests/frontend/boe-submit.test.js's validation order and prefill rules.

export type BoeFields = {
  teamId: number | null;
  charName: string;
  itemName: string;
  track: string;
  rank: string;
  note: string;
  donate: boolean;
};

export const EMPTY_BOE_FIELDS: BoeFields = {
  teamId: null,
  charName: '',
  itemName: '',
  track: '',
  rank: '',
  note: '',
  donate: false
};

export const TRACKS = ['Champion', 'Hero', 'Myth'] as const;
export const RANKS = ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6'] as const;

// Validation, in the same order as js/boe.js's submitBoeFound: the team comes
// first since there is no page team to fall back on.
export function boeFieldError(fields: BoeFields): string | null {
  if (!fields.teamId) return 'Please select the team you raided with.';
  if (!fields.charName.trim()) return 'Please enter your character name.';
  if (!fields.itemName.trim()) return 'Please select an item.';
  if (!fields.track) return 'Please select the track.';
  if (!fields.rank) return 'Please select the upgrade rank.';
  return null;
}

export type BoeCatalogRow = { id: number; name: string; wcl_zone_id: number | null };
export type ZoneRow = { wcl_zone_id: number | null; season: string | null };

// The tier's BoEs plus any unscoped one, sorted for the picker. Same
// fail-open rule as the current site: an incompletely onboarded tier (no
// zones recorded yet) offers the whole catalog rather than nothing.
export function boeSeasonCatalog(catalog: BoeCatalogRow[], seasonCode: string | null, zones: ZoneRow[]) {
  const seasonZones = new Set(
    zones.filter((z) => z.season === seasonCode && z.wcl_zone_id != null).map((z) => z.wcl_zone_id)
  );
  return catalog
    .filter((item) => item.wcl_zone_id == null || seasonZones.size === 0 || seasonZones.has(item.wcl_zone_id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The team to default to: exactly one claimed team is the only case where a
// guess beats asking (#891) -- alts on several teams could be raiding with
// any of them tonight.
export function defaultBoeTeamId(claimedTeamIds: number[]): number | null {
  return claimedTeamIds.length === 1 ? claimedTeamIds[0]! : null;
}
