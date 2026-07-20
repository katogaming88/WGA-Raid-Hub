import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression: wishlistUpsert()'s insert branch omitted team_id (a NOT NULL
// column on item_preferences), which PostgREST surfaces as a 400 Bad Request
// (not-null violation), not the 409 a real duplicate-row conflict would give
// -- caught live after Phase 1 shipped, since the RLS test suite always
// inserts through hand-written SQL fixtures that already include team_id,
// never exercising this client-side insert payload shape.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox() {
  const inserts = [];
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
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
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots: {}, itemPlaceholders: {}, itemIds: {} };
  // Simulates a player whose wishlist has already loaded (ownWishlistSectionHTML
  // sets these) with no existing preference row for the item being tagged.
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPrefs = [];

  sandbox.supabaseClient = {
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row });
          return {
            select() {
              return Promise.resolve({ data: [{ id: 1, ...row }], error: null });
            }
          };
        }
      };
    }
  };
  return { sandbox, inserts };
}

describe('wishlistUpsert insert payload', () => {
  it('includes team_id (NOT NULL column) alongside player_id/item_id', () => {
    const { sandbox, inserts } = makeSandbox();
    sandbox.wishlistSetStatus(42, null, 'bis');

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('item_preferences');
    expect(inserts[0].row).toMatchObject({
      team_id: sandbox._teamCfg.supabaseTeamId,
      player_id: 11,
      item_id: 42,
      slot: null,
      status: 'bis'
    });
  });

  it('carries the slot through for a placeholder item tagged under a specific row', () => {
    const { sandbox, inserts } = makeSandbox();
    sandbox.wishlistSetStatus(7, 'Neck', 'good');

    expect(inserts[0].row).toMatchObject({
      team_id: sandbox._teamCfg.supabaseTeamId,
      item_id: 7,
      slot: 'Neck',
      status: 'good'
    });
  });
});
