// How the News page behaves, written once and checked against both sites
// (#1102 step 1). tests/browser/news-recorded.test.js runs it against the
// current site's News tab, where it was recorded; tests/browser-app/
// news.test.js runs the same checks against the new app's News page.
//
// Both sites read news.json, so each suite answers that file with ENTRIES and
// turns what the page rendered into:
//
//   entries: [{ title, date, category, version, pinned, open, body }]
//            `body` is the text shown, or null while the entry is closed
//
// plus whether the News menu item shows its "something new" dot.
//
// Deliberate differences, checked by the new suite only:
// - Dates read "Sep 7, 2026" rather than "2026-09-07".
// - An entry's body slides open with its arrow instead of appearing at once,
//   and does not move for a reader who has asked for less motion (#1041).

const entry = (version, date, category, title, extra = {}) => ({
  date,
  category,
  version,
  title,
  body: `What changed in ${version}: ${title.toLowerCase()}.`,
  ...extra
});

// In file order, which is not display order: a pinned welcome post from
// months ago, two entries sharing the newest date, and one of each category.
export const ENTRIES = [
  entry('3.40.0', '2026-08-20', 'Feature', 'Loot history on every profile'),
  entry('3.10.0', '2026-06-01', 'Change', 'Welcome to the new Raid Hub', { pinned: true }),
  entry('3.52.0', '2026-09-07', 'Feature', 'A calendar for every raid night'),
  entry('3.51.2', '2026-09-07', 'Fix', 'Signup form keeps your off-specs'),
  entry('3.30.1', '2026-07-15', 'Fix', 'Wishlist saves on slow connections')
];

const shown = (e, open) => ({
  title: e.title,
  date: e.date,
  category: e.category,
  version: e.version,
  pinned: !!e.pinned,
  open,
  body: open ? e.body : null
});

const [LOOT, WELCOME, CALENDAR, SIGNUP, WISHLIST] = ENTRIES;

// Pinned first, then newest first; entries on the same date keep file order.
// The pinned entry and the newest entry start open.
export const EXPECTED = [
  shown(WELCOME, true),
  shown(CALENDAR, true),
  shown(SIGNUP, false),
  shown(LOOT, false),
  shown(WISHLIST, false)
];

// Clicking a closed entry's header opens it; clicking an open one closes it.
export const TOGGLE_OPEN = WISHLIST.title;
export const TOGGLE_CLOSED = CALENDAR.title;
export const AFTER_TOGGLES = EXPECTED.map((e) =>
  e.title === TOGGLE_OPEN ? shown(WISHLIST, true) : e.title === TOGGLE_CLOSED ? shown(CALENDAR, false) : e
);

// The newest entry, by date rather than position: what "seen" remembers.
export const NEWEST_VERSION = CALENDAR.version;
export const SEEN_KEY = 'wga_news_last_seen';

export const EMPTY_MESSAGE = 'No news yet.';
