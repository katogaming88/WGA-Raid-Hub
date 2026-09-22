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

// The lifecycle view (#1305), ported from js/boe-manage.js: found -> listed
// -> sold -> paid, plus retire. RLS already scopes an unfiltered read to what
// the caller may see, so this page never filters by team.
export type BoeItemRow = {
  id: number;
  team_id: number;
  finder_name: string | null;
  item_name: string;
  track: string | null;
  upgrade_rank: string | null;
  note: string | null;
  status: string;
  found_at: string;
  sold_at: string | null;
  payout_paid_at: string | null;
  retired_at: string | null;
  sale_price: number | null;
  finder_payout: number | null;
  guild_cut: number | null;
  ah_fee: number | null;
  payout_donated: boolean;
};

export type BoeListingRow = { id: number; boe_item_id: number; listed_at: string; price: number; note: string | null };

export function formatGold(n: number | null | undefined): string {
  return n == null ? '' : n.toLocaleString('en-US');
}

export function boeMoney(n: number | null | undefined): string {
  return n == null ? '' : `${formatGold(n)}g`;
}

// Accepts the formats officers actually paste: "250,000", "250000g",
// "1 000 000". Anything else (including negatives) is null, never NaN.
export function parseGoldInput(value: string): number | null {
  const cleaned = String(value ?? '')
    .replace(/[,\s]/g, '')
    .replace(/g$/i, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

export function boeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// First come, first served (port of js/boe-manage.js's _boeOlderOpenTwin): the
// oldest open row that is the same item -- same name (any case), same track,
// and the same rank when both carry one. A warning, not a block.
export function olderOpenTwin(items: BoeItemRow[], candidate: BoeItemRow): BoeItemRow | null {
  const name = (candidate.item_name || '').toLowerCase();
  const when = Date.parse(candidate.found_at);
  let twin: BoeItemRow | null = null;
  for (const other of items) {
    if (other.id === candidate.id) continue;
    if (other.status !== 'found' && other.status !== 'listed') continue;
    if ((other.item_name || '').toLowerCase() !== name) continue;
    if ((other.track || null) !== (candidate.track || null)) continue;
    if (other.upgrade_rank && candidate.upgrade_rank && other.upgrade_rank !== candidate.upgrade_rank) continue;
    const otherWhen = Date.parse(other.found_at);
    if (!(otherWhen < when)) continue;
    if (!twin || otherWhen < Date.parse(twin.found_at)) twin = other;
  }
  return twin;
}

// A donated payout pays the finder nothing and the guild everything net of
// the AH fee (the game kept that either way). The stored split stays the
// policy record -- what Undo Payout puts back -- so this is a display rule.
export function finderPaid(item: BoeItemRow): number | null {
  return item.status === 'paid' && item.payout_donated ? 0 : item.finder_payout;
}

export function guildKept(item: BoeItemRow): number | null {
  if (item.status === 'paid' && item.payout_donated) return (item.guild_cut || 0) + (item.finder_payout || 0);
  return item.guild_cut;
}

export type BoeSections = { open: BoeItemRow[]; awaiting: BoeItemRow[]; history: BoeItemRow[] };

export function groupByStatus(items: BoeItemRow[]): BoeSections {
  const open: BoeItemRow[] = [];
  const awaiting: BoeItemRow[] = [];
  const history: BoeItemRow[] = [];
  for (const item of items) {
    if (item.status === 'found' || item.status === 'listed') open.push(item);
    else if (item.status === 'sold') awaiting.push(item);
    else if (item.status === 'paid' || item.status === 'retired') history.push(item);
  }
  open.sort((a, b) => String(a.found_at || '').localeCompare(String(b.found_at || '')));
  awaiting.sort((a, b) => String(a.sold_at || '').localeCompare(String(b.sold_at || '')));
  history.sort((a, b) =>
    String(b.payout_paid_at || b.retired_at || '').localeCompare(String(a.payout_paid_at || a.retired_at || ''))
  );
  return { open, awaiting, history };
}

export type BoeTeamCredit = { teamId: number; found: number; gold: number };
export type BoeSummary = { guildIncome: number; outstanding: number; donated: number; byTeam: BoeTeamCredit[] };

// Guild income is guild_cut over sold and paid, the same measure the
// per-team credit line uses, so the two always sum to each other.
export function boeSummary(items: BoeItemRow[]): BoeSummary {
  let guildIncome = 0;
  let outstanding = 0;
  let donated = 0;
  const byTeam = new Map<number, { found: number; gold: number }>();
  for (const item of items) {
    const row = byTeam.get(item.team_id) ?? { found: 0, gold: 0 };
    row.found++;
    if (item.status === 'sold' || item.status === 'paid') {
      const kept = guildKept(item) || 0;
      row.gold += kept;
      guildIncome += kept;
    }
    byTeam.set(item.team_id, row);
    if (item.status === 'paid' && item.payout_donated) donated += item.finder_payout || 0;
    if (item.status === 'sold') outstanding += item.finder_payout || 0;
  }
  const teams = Array.from(byTeam.entries())
    .map(([teamId, v]) => ({ teamId, found: v.found, gold: v.gold }))
    .sort((a, b) => b.found - a.found || b.gold - a.gold || a.teamId - b.teamId);
  return { guildIncome, outstanding, donated, byTeam: teams };
}

export const HISTORY_PAGE_SIZE = 20;
