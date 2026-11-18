// news_posts rows for the new app's browser tests (#1230). The page reads the
// news_posts table now, so a state lists its rows under `tables`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { storedSession } from './harness.js';

const post = (id, slug, extra) => ({
  id,
  slug,
  title: slug,
  category: 'Feature',
  summary: `About ${slug}.`,
  body: `What changed in ${slug}.`,
  cover_path: null,
  cover_caption: null,
  version: null,
  pinned: false,
  published_at: '2026-09-07T16:00:00Z',
  ...extra
});

// A pinned post with a cover, two on the newest day (the later one first),
// one of each category, and, for Staff, a draft and a post set for later.
export const POSTS = [
  post(1, 'report-a-boe', {
    title: 'Report a BoE and follow it, on one page',
    summary: 'The BoE form and the record of what happened to every find now live together.',
    version: '3.88.0',
    pinned: true,
    cover_path: 'boe.png',
    cover_caption: 'The BoE page.',
    published_at: '2026-09-03T16:00:00Z'
  }),
  post(2, 'raid-calendar', {
    title: 'Raid Calendar: a day view for every raid night',
    version: '3.93.0',
    summary: "There's a Calendar now, reachable from the nav.",
    body: "Click any raid day to open that night's page.\n\n## Open any raid night\n\n- Your own status sits at the top.\n- Everyone's status is below it.\n\nArrows move you to the day before or after.",
    cover_path: 'calendar.png',
    cover_caption: 'The month view.'
  }),
  post(3, 'signup-keeps-offspecs', {
    title: 'Signup form keeps your off-specs',
    category: 'Fix',
    summary: 'Off-specs no longer reset when you go back a step.'
  }),
  post(4, 'loot-history', {
    title: 'Loot history on every profile',
    category: 'Change',
    summary: 'Every profile lists what the character has been awarded.',
    published_at: '2026-08-20T16:00:00Z'
  }),
  post(5, 'welcome', {
    title: 'Welcome to the new Raid Hub',
    category: 'Announcement',
    summary: 'A new home for the guild.',
    published_at: '2026-08-01T16:00:00Z'
  }),
  post(6, 'a-draft', { title: 'A draft', published_at: null }),
  post(7, 'set-for-later', { title: 'Set for later', published_at: '2999-01-01T16:00:00Z' })
];

// What a reader sees: no drafts, no post set for later.
export const READER_POSTS = POSTS.filter((p) => p.published_at && p.published_at < '2999');
export const NEWEST_SEEN_KEY = 'signup-keeps-offspecs';

// Signed in as Staff (a site admin).
export const STAFF = {
  session: storedSession({ battlenet: 'Staff#1', discord: 'Staff' }),
  person: {
    discordId: 'discord-staff-1',
    person: { site_admin: true, guild_officer: false, boe_manager: false, teams: [] }
  }
};

// news.json as the migration copied it into news_posts (oldest first, a later
// entry in the file on the same day getting the lower id), for the pages that
// show the site's real news.
export function newsJsonRows() {
  const entries = JSON.parse(readFileSync(fileURLToPath(new URL('../../news.json', import.meta.url)), 'utf8'));
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date === b.e.date ? b.i - a.i : a.e.date < b.e.date ? -1 : 1))
    .map(({ e }, n) =>
      post(n + 1, `entry-${n + 1}`, {
        title: e.title,
        category: e.category,
        summary: e.body.split(/(?<=[.!?])\s+/)[0],
        body: e.body,
        version: e.version,
        pinned: !!e.pinned,
        published_at: `${e.date}T16:00:00Z`
      })
    );
}

// The three newest by date, as Guild home lists them.
export const newestThree = (rows) =>
  rows
    .slice()
    .sort((a, b) => (a.published_at === b.published_at ? b.id - a.id : a.published_at < b.published_at ? 1 : -1))
    .slice(0, 3)
    .map((p) => ({ title: p.title, date: p.published_at.slice(0, 10) }));
