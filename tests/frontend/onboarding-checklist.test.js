import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #478 -- new-raider onboarding checklist gating: isRecentJoiner()/
// seasonHasStarted()/joinedAfterSeasonStart() decide whether the "wishlist
// not started" nudge (roster badge, officer dashboard alert, profile banner)
// shows for a given player.
//
// #703 -- these run on a fixed clock rather than the wall clock. "Today" in
// the functions under test is the viewer's LOCAL calendar date pinned to UTC
// midnight, so a test that builds its dates from UTC getters disagrees with
// production for part of every day. FIXED_MS is picked so the local and UTC
// calendar dates differ under the TZ the CI job pins (America/New_York, see
// .github/workflows/frontend-tests.yml): 2026-02-28 21:00 EST is 2026-03-01
// in UTC. That gap is what makes these cases fail if the date math here or
// in production ever flips to UTC getters.
const FIXED_MS = Date.UTC(2026, 2, 1, 2, 0, 0);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

// Pins new Date() and Date.now() inside the sandbox to FIXED_MS. The code
// under test only calls new Date(), Date.UTC() and the local getters, so a
// host-realm subclass is enough; nothing does an instanceof check.
class FixedDate extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super(FIXED_MS);
  }
  static now() {
    return FIXED_MS;
  }
}

function makeSandbox(DATA) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    Date: FixedDate,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  sandbox.DATA = DATA;
  return sandbox;
}

// YYYY-MM-DD string for "today + offsetDays". Today is FIXED_MS read through
// the LOCAL getters and pinned to UTC midnight, which is exactly what
// isRecentJoiner() and seasonHasStarted() do. Reading it through the UTC
// getters instead is the #703 bug: it hands production a date one day ahead
// of what production calls today, for part of every day.
function dateOffset(offsetDays) {
  const f = new Date(FIXED_MS);
  const ms = Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()) + offsetDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// #1269 -- both gates read the season's window from seasonDateRangeFor(),
// whose start for the live tier is the team's own first raid night
// (DATA.seasonStartDate, from team_season_start()) and falls back to the
// tier's start. A tier well in the past, so currentSeasonCode() answers it
// whatever the runner's time zone; only the night under test moves.
const started = (seasonStartDate) => ({
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2020-01-01', ends_at: null }],
  seasonStartDate
});

describe('seasonHasStarted', () => {
  it('is false when no tier has started', () => {
    const sandbox = makeSandbox({ seasons: [], seasonStartDate: null });
    expect(sandbox.seasonHasStarted()).toBe(false);
  });

  it('is true once today is on the first raid night', () => {
    const sandbox = makeSandbox(started(dateOffset(0)));
    expect(sandbox.seasonHasStarted()).toBe(true);
  });

  it('is true once the first raid night is in the past', () => {
    const sandbox = makeSandbox(started(dateOffset(-10)));
    expect(sandbox.seasonHasStarted()).toBe(true);
  });

  // Reachable for a viewer west of Eastern on the day the sync files a
  // team's first report, and the case that fails if the date math here or in
  // production flips to UTC getters (#703).
  it('is false when the first raid night is still in the future', () => {
    const sandbox = makeSandbox(started(dateOffset(1)));
    expect(sandbox.seasonHasStarted()).toBe(false);
  });

  it('is false for a malformed date', () => {
    const sandbox = makeSandbox(started('not-a-date'));
    expect(sandbox.seasonHasStarted()).toBe(false);
  });

  // A team with no report in the tier yet counts from the tier's own start,
  // so the nudge applies there too: every team on a started tier has a
  // window now, where a team that never typed a date had none.
  it("is true on a started tier the team has no raid night in yet", () => {
    const sandbox = makeSandbox(started(null));
    expect(sandbox.seasonHasStarted()).toBe(true);
  });
});

describe('joinedAfterSeasonStart', () => {
  it('is false when no tier has started', () => {
    const sandbox = makeSandbox({ seasons: [], seasonStartDate: null });
    expect(sandbox.joinedAfterSeasonStart({ joinDate: dateOffset(-1) })).toBe(false);
  });

  it('is true when the player joined on the first raid night itself', () => {
    const sandbox = makeSandbox(started(dateOffset(-5)));
    expect(sandbox.joinedAfterSeasonStart({ joinDate: dateOffset(-5) })).toBe(true);
  });

  it('is true when the player joined after the first raid night', () => {
    const sandbox = makeSandbox(started(dateOffset(-10)));
    expect(sandbox.joinedAfterSeasonStart({ joinDate: dateOffset(-3) })).toBe(true);
  });

  // The whole point of the derived night: someone who joined during the
  // week between the tier going live and this team first raiding it is a
  // veteran of this season, not a mid-season join.
  it('is false for a veteran who joined before the first raid night', () => {
    const sandbox = makeSandbox(started(dateOffset(-5)));
    expect(sandbox.joinedAfterSeasonStart({ joinDate: dateOffset(-10) })).toBe(false);
  });

  it('is false when the player has no join date on record', () => {
    const sandbox = makeSandbox(started(dateOffset(-5)));
    expect(sandbox.joinedAfterSeasonStart({ joinDate: '' })).toBe(false);
    expect(sandbox.joinedAfterSeasonStart({})).toBe(false);
  });
});

describe('isRecentJoiner', () => {
  it('is true for a player who joined today', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.isRecentJoiner({ joinDate: dateOffset(0) }, 30)).toBe(true);
  });

  it('is true exactly at the boundary (joined N days ago, window N)', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.isRecentJoiner({ joinDate: dateOffset(-30) }, 30)).toBe(true);
  });

  it('is false just past the boundary (joined N+1 days ago, window N)', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.isRecentJoiner({ joinDate: dateOffset(-31) }, 30)).toBe(false);
  });

  it('is false for a join date in the future (bad data)', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.isRecentJoiner({ joinDate: dateOffset(1) }, 30)).toBe(false);
  });

  it('is false when there is no join date on record', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.isRecentJoiner({ joinDate: '' }, 30)).toBe(false);
    expect(sandbox.isRecentJoiner(null, 30)).toBe(false);
  });
});
