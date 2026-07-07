// CSV loading for the #320 import generators.
//
// Tabs are exported as plain CSVs into the gitignored data/ directory. The
// cleaned exports carry the header in row 1 and data from row 2, but this
// still returns raw row arrays and lets the per-table modules slice from
// their own data-start row, so a tab that ships extra rows only needs its
// own module touched.

import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

export function loadCsv(path) {
  const raw = readFileSync(path, 'utf8');
  return parse(raw, {
    relax_column_count: true,
    skip_empty_lines: false,
    bom: true
  });
}

// Optional tabs: returns null instead of throwing when the export is absent.
export function loadCsvIfPresent(path) {
  return existsSync(path) ? loadCsv(path) : null;
}

// Sanity-check a header row so a re-ordered or wrong-tab export fails loudly
// instead of importing garbage. `expected` maps 0-based column index -> a
// case-insensitive substring that must appear in that header cell.
export function assertHeader(rows, headerRowIndex, expected, label) {
  const header = rows[headerRowIndex] || [];
  for (const [idx, want] of Object.entries(expected)) {
    const got = String(header[idx] || '');
    if (!got.toLowerCase().includes(want.toLowerCase())) {
      throw new Error(
        `${label}: header row ${headerRowIndex + 1} col ${Number(idx) + 1} ` +
          `expected to contain ${JSON.stringify(want)}, got ${JSON.stringify(got)}`
      );
    }
  }
}
