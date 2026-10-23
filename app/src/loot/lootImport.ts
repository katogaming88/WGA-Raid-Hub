// Officer Loot: Import (#1363), ported from js/tabs/tab-loot-import.js. Pure
// rules kept apart from the page, so the paste parsing and the grouping of
// the import history are tested without rendering.

export type RclcRow = {
  id: string;
  player: string;
  date: string;
  time: string;
  itemID: string | number | null;
  itemName: string;
  // The item's own bonus ids, which import_rclc_loot() prefers over the
  // instance text for the track (20260829200033).
  itemString: string;
  instance: string;
  boss: string;
  response: string;
};

const text = (v: unknown) => String(v ?? '').trim();

// RCLootCouncil's JSON export, picked down to the fields import_rclc_loot()
// reads. An entry without an id, player or instance can't be matched or
// deduplicated, so it is left out rather than sent.
export function parseRclcPaste(paste: string): { rows: RclcRow[] } | { error: string } {
  if (!paste.trim()) return { error: 'Paste the RCLootCouncil JSON export first.' };
  let entries: unknown;
  try {
    entries = JSON.parse(paste);
  } catch {
    return { error: "That isn't valid JSON. Copy the whole export, from [ to ]." };
  }
  if (!Array.isArray(entries)) return { error: 'Expected a list of awards, starting with [.' };
  const rows = entries
    .map((e: Record<string, unknown>) => ({
      id: text(e?.id),
      player: text(e?.player),
      date: text(e?.date),
      time: text(e?.time),
      itemID: (e?.itemID ?? null) as string | number | null,
      itemName: text(e?.itemName),
      itemString: text(e?.itemString),
      instance: text(e?.instance),
      boss: text(e?.boss),
      response: text(e?.response)
    }))
    .filter((r) => r.id && r.player && r.instance);
  if (!rows.length) return { error: 'No awards found. Each one needs an id, a player and an instance.' };
  return { rows };
}

export type ImportCounts = { inserted?: number; skipped_duplicate?: number; unresolved_item?: number };

export function importSummary(counts: ImportCounts): string {
  const inserted = counts.inserted ?? 0;
  const skipped = counts.skipped_duplicate ?? 0;
  const unresolved = counts.unresolved_item ?? 0;
  let msg = `Imported ${inserted} new award${inserted === 1 ? '' : 's'}`;
  if (skipped) msg += `, skipped ${skipped} already on file`;
  if (unresolved) msg += `, ${unresolved} with an item the hub doesn't know`;
  return `${msg}.`;
}

// Rows written before 20260822203445 carry a plain-string detail and no
// season, so they can't be put in one.
export const UNKNOWN_SEASON = '__unknown__';

export type ImportAuditRow = {
  actor_id: string | null;
  target_type: string | null;
  target_id: number | null;
  detail: unknown;
  created_at: string;
};

export type ImportEvent = {
  key: string;
  actorId: string | null;
  at: string;
  season: string;
  itemCount: number;
  // Item summaries ("Hero - Item name") by player id.
  byPlayer: Map<number, string[]>;
};

const summaryOf = (detail: unknown): string =>
  typeof detail === 'string' ? detail : ((detail as { summary?: string } | null)?.summary ?? 'Unknown item');

const seasonOf = (detail: unknown): string =>
  (typeof detail === 'object' && (detail as { season?: string } | null)?.season) || UNKNOWN_SEASON;

// One entry per paste. import_rclc_loot() logs a row per award, all in one
// transaction, so every row of one paste shares its created_at exactly
// (now() is frozen for the transaction): actor plus time is the paste.
// Newest first.
export function groupImports(rows: ImportAuditRow[]): ImportEvent[] {
  const byKey = new Map<string, ImportEvent>();
  for (const row of rows) {
    const key = `${row.actor_id ?? 'unknown'}|${row.created_at}`;
    let event = byKey.get(key);
    if (!event) {
      event = {
        key,
        actorId: row.actor_id,
        at: row.created_at,
        season: seasonOf(row.detail),
        itemCount: 0,
        byPlayer: new Map()
      };
      byKey.set(key, event);
    }
    event.itemCount++;
    if (row.target_type === 'players' && row.target_id != null) {
      const items = event.byPlayer.get(row.target_id) ?? [];
      items.push(summaryOf(row.detail));
      event.byPlayer.set(row.target_id, items);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// The seasons with imports, newest code first, unknown last.
export function importSeasons(events: ImportEvent[]): string[] {
  return [...new Set(events.map((e) => e.season))].sort((a, b) =>
    a === UNKNOWN_SEASON ? 1 : b === UNKNOWN_SEASON ? -1 : a < b ? 1 : a > b ? -1 : 0
  );
}
