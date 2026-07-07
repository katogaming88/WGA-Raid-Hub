// Timestamp handling for the #320 import generators.
//
// Sheet cells hold native Dates; CSV export formats them per the sheet's
// display format, so several shapes show up: ISO-ish ("2026-01-03 19:00:00"),
// US short ("1/3/2026 19:00:00"), and the display format the request tabs use
// ("Jan 3, 2026 19:00"). All are wall-clock times in the spreadsheet's
// timezone with no zone marker. Rather than doing DST math here, the emitted
// SQL converts at apply time:  '<local>'::timestamp at time zone '<tz>'.

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12'
};

const pad = (n) => String(n).padStart(2, '0');

// Normalize any accepted sheet timestamp to 'YYYY-MM-DD HH:MM:SS' (local
// wall-clock), or null for blank input. Throws on unrecognized shapes.
export function parseSheetTimestamp(value) {
  const s = String(value || '').trim();
  if (!s) return null;

  // 2026-01-03[ T]19:00[:00]  or bare 2026-01-03 / 2026/01/03
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  }

  // 1/3/2026 19:00[:00]  (US month/day)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return `${m[3]}-${pad(m[1])}-${pad(m[2])} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  }

  // 3/19/26 22:35[:00]  (US month/day, two-digit year -> 20yy; the Loot Data
  // export's date column uses this shape)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return `20${m[3]}-${pad(m[1])}-${pad(m[2])} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  }

  // Jan 3, 2026 19:00
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${pad(m[2])} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  }

  throw new Error(`Unrecognized timestamp: ${JSON.stringify(value)}`);
}

// SQL expression for a wall-clock timestamp in the sheet's timezone.
export function sqlTimestampAtZone(value, tz) {
  const local = parseSheetTimestamp(value);
  if (!local) return 'null';
  return `('${local}'::timestamp at time zone '${tz}')`;
}

// Season lookup by date from the ranges config ({name, start, end?}[]).
// end is inclusive; an open-ended current season omits it.
export function seasonForDate(isoDate, seasons) {
  const d = String(isoDate).slice(0, 10);
  for (const s of seasons || []) {
    if (d >= s.start && (!s.end || d <= s.end)) return s.name;
  }
  return null;
}
