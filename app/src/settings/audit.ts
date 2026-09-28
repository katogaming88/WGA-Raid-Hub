// Officer Settings: Audit log (#1358, #1103 row 1), ported from
// js/tabs/tab-audit.js. Pure rules kept apart from the page (data resolution
// and rendering) so the detail-string formatting and search are tested
// without rendering.

export type AuditEntry = {
  id: number;
  ts: string;
  changedBy: string;
  action: string;
  target: string;
  detail: string;
};

// Known short keys that don't title-case cleanly on their own (bis -> BiS,
// not Bis; mplus -> M+, not Mplus).
const DETAIL_LABELS: Record<string, string> = { bis: 'BiS', mplus: 'M+' };

export function humanizeAuditKey(key: string): string {
  if (DETAIL_LABELS[key]) return DETAIL_LABELS[key]!;
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function humanizeAuditValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  // A diff value that's an array (bios lists, seasonHistory, raidProgression,
  // etc.) isn't meaningful to spell out item-by-item in a one-line summary.
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  return String(v);
}

// Flattens nested objects to just their leaf key/value pairs -- a feature
// flag diff like {features: {bench: false}} renders as "Bench: Off" rather
// than repeating the (here, uninformative) parent key name.
function humanizeAuditEntries(obj: Record<string, unknown>, out: string[]): void {
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      humanizeAuditEntries(v as Record<string, unknown>, out);
    } else {
      out.push(`${humanizeAuditKey(k)}: ${humanizeAuditValue(v)}`);
    }
  });
}

export function formatAuditDetail(detail: unknown): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  const out: string[] = [];
  humanizeAuditEntries(detail as Record<string, unknown>, out);
  return out.join(', ');
}

export const AUDIT_PAGE_SIZE = 50;

// One page of a filtered list, clamped so a stale page number (a search that
// just shrank the list) never slices past the end.
export function paginateAuditEntries(
  entries: AuditEntry[],
  page: number,
  pageSize: number = AUDIT_PAGE_SIZE
): { rows: AuditEntry[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const clamped = Math.min(Math.max(page, 0), totalPages - 1);
  return { rows: entries.slice(clamped * pageSize, clamped * pageSize + pageSize), page: clamped, totalPages };
}

// _renderAuditLog()'s search: case-insensitive across every visible column.
export function filterAuditEntries(entries: AuditEntry[], search: string): AuditEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.changedBy.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.target.toLowerCase().includes(q) ||
      e.detail.toLowerCase().includes(q)
  );
}
