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

  // Editing open for the live season (#939: the switch is the team_seasons
  // row for the tier the row is stamped with) -- these tests cover the insert
  // payload shape, not the open/closed editing gate itself.
  sandbox.DATA = {
    itemSlots: {},
    itemPlaceholders: {},
    itemIds: {},
    seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null }],
    teamSeasons: [{ season_code: 'MID2', wishlist_open: true }]
  };
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

  it('does nothing when wishlist editing is closed for the tier', () => {
    const { sandbox, inserts } = makeSandbox();
    sandbox.DATA.teamSeasons = [{ season_code: 'MID2', wishlist_open: false }];
    sandbox.wishlistSetStatus(42, null, 'bis');
    expect(inserts).toHaveLength(0);
  });

  // #936: the column holds a code, so the stamp is the code the gate already
  // read. It used to be that code converted back to a display name, for this
  // one column.
  it('stamps the season code, not the display name', () => {
    const { sandbox, inserts } = makeSandbox();
    sandbox.wishlistSetStatus(42, null, 'bis');
    expect(inserts[0].row.season).toBe('MID2');
  });

  // This used to assert the insert stamped null rather than the empty string,
  // which is not a seasons row and fails the foreign key with an error a raider
  // could not act on. That insert can no longer happen: with no tier resolving
  // the page does not know which season it is planning, so it writes nothing
  // (#936). The raider an officer allowed is the only one who reaches a write
  // at all here, because the team switch reads closed without a tier.
  it('writes nothing when no tier resolves, even for a raider an officer allowed', () => {
    const { sandbox, inserts } = makeSandbox();
    sandbox.DATA.seasons = [];
    sandbox.DATA.teamSeasons = [];
    sandbox._wishlistPlayerNameRealm = 'Kat-Stormrage';
    sandbox.DATA.roster = [{ nameRealm: 'Kat-Stormrage', wishlistAllowed: true }];
    // findRosterPlayerByNameRealm() reads window.DATA, not the bare global.
    sandbox.window.DATA = sandbox.DATA;
    sandbox.wishlistSetStatus(42, null, 'bis');
    expect(inserts).toHaveLength(0);
  });

  // The rule the case above used to carry, kept where it now lives. Nothing
  // writes this value today, and the day something does the empty string is
  // still the wrong answer.
  it('resolves a missing tier to null, never the empty string', () => {
    const { sandbox } = makeSandbox();
    sandbox.DATA.seasons = [];
    expect(sandbox.wishlistSeasonCode()).toBeNull();
  });
});
