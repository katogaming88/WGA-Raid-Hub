import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// populateBossFilters() used to sort the boss dropdown alphabetically,
// which doesn't match the actual in-game kill order raiders/officers expect
// when scanning a raid tier's loot. It now sorts by DATA.raidProgression
// (Season Settings' drag-reorderable boss list) instead, falling back to
// alphabetical for any boss that doesn't appear there.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeEl() {
  return { innerHTML: '' };
}

// populateBossFilters() now calls isItemInSeasonScope() (#535, common.js) to
// drop stale-season bosses from the dropdown, so common.js has to be loaded
// into the same vm context first -- same pattern as get-rank-pill.test.js.
function makeSandbox({ itemBosses, raidProgression }) {
  const els = { prioBossFilter: makeEl(), unmanagedBossFilter: makeEl() };
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    Intl,
    document: { getElementById: (id) => els[id] || null, createElement: () => ({}), head: { appendChild: () => {} } },
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox.DATA = { itemBosses, raidProgression };
  return { sandbox, els };
}

function optionOrder(html) {
  return [...html.matchAll(/<option value="[^"]*">([^<]+)<\/option>/g)]
    .map((m) => m[1])
    .filter((n) => n !== 'All Bosses');
}

describe('populateBossFilters boss ordering', () => {
  it('orders bosses by raid kill order instead of alphabetically', () => {
    const itemBosses = {
      'Item A': 'Voracius',
      'Item B': "Belo'ren",
      'Item C': 'Crown of the Cosmos'
    };
    const raidProgression = [
      {
        zoneId: 1,
        label: 'Test Raid',
        bosses: [{ name: "Belo'ren" }, { name: 'Crown of the Cosmos' }, { name: 'Voracius' }]
      }
    ];
    const { sandbox, els } = makeSandbox({ itemBosses, raidProgression });

    sandbox.populateBossFilters();

    expect(optionOrder(els.prioBossFilter.innerHTML)).toEqual(["Belo'ren", 'Crown of the Cosmos', 'Voracius']);
    expect(optionOrder(els.unmanagedBossFilter.innerHTML)).toEqual(["Belo'ren", 'Crown of the Cosmos', 'Voracius']);
  });

  it('flattens multiple raid tiers in order, earlier tier bosses first', () => {
    const itemBosses = { A: 'Boss Two', B: 'Boss One', C: 'Boss Four', D: 'Boss Three' };
    const raidProgression = [
      { zoneId: 1, label: 'Tier 1', bosses: [{ name: 'Boss One' }, { name: 'Boss Two' }] },
      { zoneId: 2, label: 'Tier 2', bosses: [{ name: 'Boss Three' }, { name: 'Boss Four' }] }
    ];
    const { sandbox, els } = makeSandbox({ itemBosses, raidProgression });

    sandbox.populateBossFilters();

    expect(optionOrder(els.prioBossFilter.innerHTML)).toEqual(['Boss One', 'Boss Two', 'Boss Three', 'Boss Four']);
  });

  it('falls back to alphabetical for a boss missing from raidProgression, placed after known bosses', () => {
    const itemBosses = { A: 'Unknown Boss', B: 'Boss Two', C: 'Boss One' };
    const raidProgression = [{ zoneId: 1, label: 'Tier 1', bosses: [{ name: 'Boss One' }, { name: 'Boss Two' }] }];
    const { sandbox, els } = makeSandbox({ itemBosses, raidProgression });

    sandbox.populateBossFilters();

    expect(optionOrder(els.prioBossFilter.innerHTML)).toEqual(['Boss One', 'Boss Two', 'Unknown Boss']);
  });

  it('falls back to fully alphabetical when raidProgression is empty/unset', () => {
    const itemBosses = { A: 'Zed', B: 'Alpha' };
    const { sandbox, els } = makeSandbox({ itemBosses, raidProgression: [] });

    sandbox.populateBossFilters();

    expect(optionOrder(els.prioBossFilter.innerHTML)).toEqual(['Alpha', 'Zed']);
  });
});
