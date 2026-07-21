import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #529 (companion to #359): mapSupabaseBisItems()/mapSupabasePriorityOrder()
// key by full character identity (name_realm) instead of first name alone,
// so two roster characters sharing a first name no longer collapse into one
// BiS list / one priority-order ranked slot.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

function bisRow(overrides) {
  return {
    player_id: 1,
    slot: 'Head',
    obtained: false,
    players: { name_realm: 'Katorri-Stormrage' },
    items: { name: 'Signet of the Starved Beast', slot: 'Head', is_placeholder: false },
    ...overrides
  };
}

describe('mapSupabaseBisItems (#529)', () => {
  it('keys the BiS list by full name_realm identity, not first name', () => {
    const sandbox = loadCommonJs();
    const map = sandbox.mapSupabaseBisItems([bisRow()]);
    expect(Object.keys(map)).toEqual(['Katorri-Stormrage']);
    expect(map['Katorri-Stormrage']).toHaveLength(1);
  });

  it('keeps two characters sharing a first name as separate BiS lists', () => {
    const sandbox = loadCommonJs();
    const rows = [
      bisRow(),
      bisRow({ player_id: 2, players: { name_realm: 'Katorri-Illidan' }, items: { name: 'Bond of Light', slot: 'Back' } })
    ];
    const map = sandbox.mapSupabaseBisItems(rows);
    expect(Object.keys(map).sort()).toEqual(['Katorri-Illidan', 'Katorri-Stormrage']);
    expect(map['Katorri-Stormrage']).toHaveLength(1);
    expect(map['Katorri-Illidan']).toHaveLength(1);
  });
});

describe('getBisItems (#529 identity lookup, dual-mode)', () => {
  it('finds a BiS list by exact full identity', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { bisList: sandbox.mapSupabaseBisItems([bisRow()]) };
    expect(sandbox.getBisItems('Katorri-Stormrage')).toHaveLength(1);
  });

  it('does not confuse two characters sharing a first name when looked up by identity', () => {
    const sandbox = loadCommonJs();
    const rows = [
      bisRow(),
      bisRow({ player_id: 2, players: { name_realm: 'Katorri-Illidan' }, items: { name: 'Bond of Light', slot: 'Back' } })
    ];
    sandbox.DATA = { bisList: sandbox.mapSupabaseBisItems(rows) };
    expect(sandbox.getBisItems('Katorri-Stormrage')[0].item).toBe('Signet of the Starved Beast');
    expect(sandbox.getBisItems('Katorri-Illidan')[0].item).toBe('Bond of Light');
  });

  it('still falls back to an ambiguous first-name match for a bare-first-name caller', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { bisList: sandbox.mapSupabaseBisItems([bisRow()]) };
    expect(sandbox.getBisItems('Katorri')).toHaveLength(1);
  });
});

function prioRow(overrides) {
  return {
    season: 'MID1',
    rank: 0,
    track: 'Hero',
    items: { name: 'Signet of the Starved Beast' },
    players: { name_realm: 'Katorri-Stormrage' },
    ...overrides
  };
}

describe('mapSupabasePriorityOrder (#529)', () => {
  it('pushes the full name_realm identity into the ranked list, not first name', () => {
    const sandbox = loadCommonJs();
    const result = sandbox.mapSupabasePriorityOrder([prioRow()], 'MID1');
    expect(result['Signet of the Starved Beast'].heroic).toEqual(['Katorri-Stormrage']);
  });

  it('keeps two characters sharing a first name as distinct ranked entries', () => {
    const sandbox = loadCommonJs();
    const rows = [
      prioRow({ rank: 0 }),
      prioRow({ rank: 1, players: { name_realm: 'Katorri-Illidan' } })
    ];
    const result = sandbox.mapSupabasePriorityOrder(rows, 'MID1');
    expect(result['Signet of the Starved Beast'].heroic).toEqual(['Katorri-Stormrage', 'Katorri-Illidan']);
  });
});
