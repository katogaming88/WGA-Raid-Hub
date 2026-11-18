// How the current site's News tab behaves, recorded in #1102 step 1 and
// checked by tests/browser/news-recorded.test.js against index.html, which
// keeps reading news.json until cutover.
//
// The new app no longer shares this: since #1230 its News is posts in the
// news_posts table, each on its own page, and tests/browser-app/news.test.js
// checks that instead.
//
// The test answers news.json with ENTRIES and turns what the page rendered
// into:
//
//   entries: [{ title, date, category, version, pinned, open, body }]
//            `body` is the text shown, or null while the entry is closed
//
// plus whether the News menu item shows its "something new" dot.

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
