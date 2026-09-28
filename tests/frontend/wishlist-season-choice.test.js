import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #936, decision 13 on #1189: Season View is the officer's planning control,
// and it used to choose the season a raider's own wishlist was on as well.
// The raider's page is on the seasons the team opened instead: the live tier
// while the raider can edit it, else the newest season open to them after it,
// else the live tier to read. An officer's pin no longer moves where a raider's
// picks land, and a switch left on for a finished tier does not send a raider
// back to it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

const MID3 = { code: 'MID3', display_name: 'Midnight Season 3', starts_at: '2099-01-01', ends_at: null };
const MID2 = { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null };
const MID1 = { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-02-01', ends_at: '2026-08-10' };

const open = (...codes) => codes.map((code) => ({ season_code: code, wishlist_open: true }));

function makeSandbox({ teamSeasons = [], seasonView, allowed = false } = {}) {
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
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = {
    itemSlots: {},
    itemIds: { 'M+': 19 },
    itemPlaceholders: { 'M+': true },
    itemNamesById: { 19: 'M+' },
    // Newest first, the order the bootstrap read gives DATA.seasons. MID3 has
    // not started, so the live tier is MID2.
    seasons: [MID3, MID2, MID1],
    teamSeasons,
    seasonView,
    roster: [{ id: 11, firstName: 'Kat', nameRealm: 'Kat-Stormrage', wishlistAllowed: allowed }]
  };
  // findRosterPlayerByNameRealm() reads window.DATA, not the bare global.
  sandbox.window.DATA = sandbox.DATA;
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPlayerNameRealm = 'Kat-Stormrage';
  sandbox._wishlistPrefs = [];
  return sandbox;
}

describe('openWishlistSeasonCodes', () => {
  it('lists the seasons the team opened the wishlist for, newest first', () => {
    const sandbox = makeSandbox({
      teamSeasons: [...open('MID1', 'MID3'), { season_code: 'MID2', wishlist_open: false, signups_open: true }]
    });
    expect([...sandbox.openWishlistSeasonCodes()]).toEqual(['MID3', 'MID1']);
  });

  it('lists nothing for a team with no row', () => {
    expect([...makeSandbox().openWishlistSeasonCodes()]).toEqual([]);
  });
});

describe('the season a raider’s own wishlist is on', () => {
  it('is the live tier while it is open, whatever season an officer pinned', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID1', 'MID2'), seasonView: 'MID1' });
    expect(sandbox.wishlistSeasonCode()).toBe('MID2');
  });

  it('is the newest open season when the live tier is closed', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID1', 'MID3') });
    expect(sandbox.wishlistSeasonCode()).toBe('MID3');
  });

  // The override opens editing without a team switch, and it is for the tier
  // being raided. With no picker on this page, sending an allowed raider to
  // another open season would leave them no way back to the live tier.
  it('is the live tier for a raider an officer allowed, with another season open', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID3'), allowed: true });
    expect(sandbox.wishlistSeasonCode()).toBe('MID2');
  });

  it('is the live tier, to read, when nothing is open', () => {
    const sandbox = makeSandbox({ seasonView: 'MID1' });
    expect(sandbox.wishlistSeasonCode()).toBe('MID2');
  });

  // The day a new tier starts, the finished tier's switch is usually still on,
  // since nothing turns it off. Its raiders stay on the new tier, read-only,
  // until an officer opens it, rather than editing a finished tier's wishlist.
  it('is the live tier, to read, when only a season before it is open', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID1') });
    expect(sandbox.wishlistSeasonCode()).toBe('MID2');
    expect(sandbox.wishlistEditableNow()).toBe(false);
  });

  // The seasons read failing is what an empty DATA.seasons means, since the
  // table is filled by migration. The page cannot tell the live tier or the
  // order of the open ones then, so it stays on no season and read-only, as
  // it did before this change.
  it('is no season when the seasons read failed, even with a switch open', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID2') });
    sandbox.DATA.seasons = [];
    expect(sandbox.wishlistSeasonCode()).toBeNull();
  });
});

describe('whether a raider can edit their own wishlist', () => {
  it('follows the season the page is on, not the one an officer pinned', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID2'), seasonView: 'MID1' });
    expect(sandbox.wishlistEditableNow()).toBe(true);
  });

  it('is open on the next season when the team opened it before it starts', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID3') });
    expect(sandbox.wishlistSeasonCode()).toBe('MID3');
    expect(sandbox.wishlistEditableNow()).toBe(true);
  });

  it('is closed with nothing open', () => {
    expect(makeSandbox({ seasonView: 'MID1' }).wishlistEditableNow()).toBe(false);
  });

  it('is open on the live tier for a raider an officer allowed', () => {
    expect(makeSandbox({ allowed: true }).wishlistEditableNow()).toBe(true);
  });
});

// The page says which season it is on, since that is no longer always the live
// tier, and a raider editing the next tier's wishlist has to be able to tell.
describe('the season a raider’s own wishlist names', () => {
  const body = (sandbox) =>
    sandbox.wishlistSectionBodyHTML({ id: 11, firstName: 'Kat', class: 'Death Knight', spec: 'Frost' });

  it('is the live tier while it is open', () => {
    expect(body(makeSandbox({ teamSeasons: open('MID2') }))).toContain(
      'Wishlist for <strong>Midnight Season 2</strong>'
    );
  });

  it('is the next season when that is the one the page is on', () => {
    expect(body(makeSandbox({ teamSeasons: open('MID3') }))).toContain(
      'Wishlist for <strong>Midnight Season 3</strong>'
    );
  });

  it('is the live tier, read-only, when nothing is open', () => {
    expect(body(makeSandbox())).toContain('Wishlist for <strong>Midnight Season 2</strong>');
  });

  it('is left out when no season resolves', () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID2') });
    sandbox.DATA.seasons = [];
    expect(body(sandbox)).not.toContain('Wishlist for');
  });
});

// The raider's own rows are already one season when they arrive (the read is
// narrowed to it), and the Other Sources rows are scoped once more by the
// season on the row. Scoped against the officer's pin, a pin on another
// season hid every M+ and crafted pick from the raider's own page.
describe('an officer’s pin does not hide a raider’s own M+ and crafted picks', () => {
  const mplus = { id: 1, item_id: 19, status: 'bis', note: null, slot: 'Neck', season: 'MID2' };
  const pinned = () => {
    const sandbox = makeSandbox({ teamSeasons: open('MID2'), seasonView: 'MID1' });
    sandbox._wishlistPrefs = [mplus];
    return sandbox;
  };

  it('on the Other Sources card', () => {
    expect(pinned().wishlistOtherSourcesTaggedSlots()).toEqual({ Neck: 'M+' });
  });

  it('on the raider’s BiS List', () => {
    const items = pinned().wishlistBisItems({ id: 11 });
    expect(items.map((i) => [i.item, i.slot])).toEqual([['M+', 'Neck']]);
  });

  it('on the live BiS completion badge', () => {
    const sandbox = pinned();
    sandbox.getDiscordSession = () => ({ nameRealm: 'Kat-Stormrage' });
    const items = sandbox.mergedBisItemsForNameRealm('Kat-Stormrage');
    expect(items.map((i) => [i.item, i.slot])).toEqual([['M+', 'Neck']]);
  });

  // The officer-side reader of the same rows keeps the season on screen (#1351).
  it('while an officer’s reading of them keeps the pin', () => {
    const sandbox = pinned();
    expect([...sandbox.bisItemsFromWishlistPrefs([mplus], 11)]).toEqual([]);
  });
});
