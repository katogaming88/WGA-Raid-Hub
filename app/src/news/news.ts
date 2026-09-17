// The News page's rules (#1102): the order entries are listed in, which start
// open, and whether there is anything the reader has not seen. Ported from the
// current site's js/news.js and recorded against it in tests/behavior/news.js.

export type NewsCategory = 'Feature' | 'Fix' | 'Change';

// One entry of news.json, the hand-written list at the repo root.
export type NewsEntry = {
  date: string;
  category: string;
  version: string;
  title: string;
  body: string;
  pinned?: boolean;
};

// Pinned entries first (an announcement an officer wants read however old it
// is), then newest first. Entries on the same date keep the file's order.
export function sortNews(entries: NewsEntry[]): NewsEntry[] {
  return entries.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.date === b.date) return 0;
    return a.date < b.date ? 1 : -1;
  });
}

// The newest entry by date, pinned or not: the first of the newest date in
// display order.
export function newestEntry(entries: NewsEntry[]): NewsEntry | null {
  let newest: NewsEntry | null = null;
  for (const entry of sortNews(entries)) {
    if (!newest || entry.date > newest.date) newest = entry;
  }
  return newest;
}

// Pinned entries and the newest one start open; the reader can open or close
// any of them.
export function openByDefault(entry: NewsEntry, newest: NewsEntry | null): boolean {
  return !!entry.pinned || (newest !== null && newest.version === entry.version);
}

// Something new: the newest entry is not the one the reader last saw. Keyed on
// the version, which is unique per entry, since several entries often share a
// date (js/news.js).
export function hasUnread(entries: NewsEntry[], lastSeen: string | null): boolean {
  const newest = newestEntry(entries);
  return newest !== null && newest.version !== lastSeen;
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const isIsoDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);

// "Sep 7, 2026", or the date as written when it is not YYYY-MM-DD.
export const newsDate = (date: string) => (isIsoDate(date) ? LONG_DATE.format(new Date(`${date}T00:00:00Z`)) : date);

// "Sep 7", for the short list on Guild home.
export const newsShortDate = (date: string) =>
  isIsoDate(date) ? SHORT_DATE.format(new Date(`${date}T00:00:00Z`)) : date;

export const categoryKind = (category: string): 'feature' | 'fix' | 'change' | 'other' =>
  category === 'Feature' ? 'feature' : category === 'Fix' ? 'fix' : category === 'Change' ? 'change' : 'other';
