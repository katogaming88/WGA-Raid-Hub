import { describe, it, expect } from 'vitest';
import { summaryTable } from '../../scripts/ci/functions-summary.js';

// The table the `functions` job writes to the run summary after a deploy
// (#1083), from `supabase functions list -o json`: one row per function,
// sorted by name, with the version and the deploy time to the minute.

const listed = {
  functions: [
    { slug: 'wcl-sync', version: 32, updated_at: Date.UTC(2026, 8, 12, 21, 40) },
    { slug: 'boe-webhook', version: 17, updated_at: Date.UTC(2026, 8, 8, 3, 33) }
  ]
};

describe('the functions summary table', () => {
  it('is a markdown table sorted by name, one row per function', () => {
    expect(summaryTable(listed)).toBe(
      [
        '',
        '| Function | Version | Updated |',
        '|---|---|---|',
        '| boe-webhook | 17 | 2026-09-08 03:33 |',
        '| wcl-sync | 32 | 2026-09-12 21:40 |'
      ].join('\n')
    );
  });

  it('accepts the bare array shape as well as the wrapped one', () => {
    expect(summaryTable(listed.functions)).toBe(summaryTable(listed));
  });

  it('says so when there is nothing to list', () => {
    expect(summaryTable({ functions: [] })).toBe('\nNo functions listed.');
  });
});
