import { describe, it, expect } from 'vitest';
import { splitSource, parseSelfReceived, selfReceivedSql } from '../../scripts/import/tables/self-received.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';
import { normName } from '../../scripts/import/lib/names.js';

function selfReceivedRows() {
  return [
    ['Timestamp', 'Player', 'Item', 'Slot', 'Source', 'Notes', 'Status'],
    ['Jun 1, 2026 20:00', 'Hinda-Thrall', 'Crown of Testing', 'Head', 'Mythic: Bonus Roll', 'yay', 'Approved'],
    ['Jun 2, 2026 20:00', 'Tanky-Thrall', "Slayer's Band", 'Ring', 'Bonus Roll', '', 'Pending'],
    ['Jun 3, 2026 20:00', 'Hinda', 'Crown of Testing', 'Head', 'Normal: Great Vault', '', 'Rejected']
  ];
}

const KNOWN = new Set(['crown of testing', "slayer's band"].map(normName));

describe('splitSource', () => {
  it('splits a difficulty prefix from the source, mapping it to a track', () => {
    expect(splitSource('Mythic: Bonus Roll')).toEqual({ track: 'Myth', source: 'Bonus Roll' });
    expect(splitSource('Heroic: Great Vault')).toEqual({ track: 'Hero', source: 'Great Vault' });
  });
  it('defaults bare values to the Myth track like the app does', () => {
    expect(splitSource('Bonus Roll')).toEqual({ track: 'Myth', source: 'Bonus Roll' });
    expect(splitSource('Crafted')).toEqual({ track: 'Myth', source: 'Crafted' });
  });
  it('maps the base tier to Champion and empties to null', () => {
    expect(splitSource('Normal: Great Vault')).toEqual({ track: 'Champion', source: 'Great Vault' });
    expect(splitSource('')).toEqual({ track: null, source: null });
  });
});

describe('parseSelfReceived + selfReceivedSql', () => {
  it('parses rows, lowercases statuses, and emits split source columns', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);
    const entries = parseSelfReceived(selfReceivedRows());
    const { sql, count, warnings } = selfReceivedSql(1, entries, registry, 'America/New_York', KNOWN);
    expect(count).toBe(3);
    expect(warnings).toHaveLength(0);
    expect(sql).toContain("'approved'");
    expect(sql).toContain("'Myth', 'Bonus Roll'");
    expect(sql).toContain("'Champion', 'Great Vault'");
    expect(sql).toContain('status, track, source');
    expect(sql).toContain('where not exists');
    expect(sql).toContain('t.self_item_id = v.self_item_id');
  });
  it('rejects unknown statuses', () => {
    const rows = selfReceivedRows();
    rows[1][6] = 'Maybe';
    expect(() => parseSelfReceived(rows)).toThrow(/status/);
  });
  it('warns on items missing from the Item Lookup', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall']);
    const entries = parseSelfReceived(selfReceivedRows());
    const { warnings } = selfReceivedSql(1, entries, registry, 'UTC', new Set(['crown of testing']));
    expect(warnings.join('\n')).toContain("Slayer's Band");
  });
});
