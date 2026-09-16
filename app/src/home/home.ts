import { difficultyOf, type Difficulty, type LootRow, type SeasonWindow } from '../profile/profile';

// The team Home page's two blocks so far (#1102): the stats row and the recent
// loot feed. Everything here is a pure function of rows that have already been
// read, so the behavior recorded from the current site
// (tests/behavior/home.js) can be checked without a browser as well as in one.

export type FeedRow = {
  key: number;
  player: string;
  item: string;
  difficulty: Difficulty;
  date: string;
  offSpec: boolean;
};

// How many raiders the team has: a row with no role is not a roster entry, the
// same rule the roster page groups by.
export function raiderCount(players: { classes_specs: { role: string | null } | null }[]): number {
  return players.filter((p) => p.classes_specs?.role).length;
}

// An off-spec or Mythic+ roll, from the loot council response the import
// recorded. Deliberately the current site's rule, character for character
// (isOffSpecLootResponse, js/common.js), so the feed tags exactly what it
// tags today -- including the known gap where "Offspec/Greed" and "Mythic+"
// match neither this nor the priority SQL. Widening it is its own decision,
// and it has to move in both places at once.
export function isOffSpec(response: string | null | undefined): boolean {
  const r = String(response ?? '');
  return /\bos\b/i.test(r) || /m\+/i.test(r);
}

// Award dates are shown on Eastern time, where the raids happen, so an award
// late on raid night keeps that night's date wherever the reader is.
const AWARD_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export type FeedLootRow = LootRow & {
  response: string | null;
  players: { name_realm: string; nickname: string | null } | null;
};

// The name a raider goes by: their nickname, or their character's first name.
function displayName(player: FeedLootRow['players']): string {
  const nickname = player?.nickname?.trim();
  if (nickname) return nickname;
  const first = ((player?.name_realm ?? '').split('-')[0] ?? '').trim();
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Unknown';
}

// Every award this season, newest first. An off-spec roll stays in the feed
// (tagged) but is left out of the stat above it: that number is what the team
// won on its main specs.
export function lootFeed(rows: FeedLootRow[], season: SeasonWindow): FeedRow[] {
  return rows
    .filter((r) => season.code === null || r.season === season.code)
    .sort((a, b) => (a.awarded_at < b.awarded_at ? 1 : a.awarded_at > b.awarded_at ? -1 : b.id - a.id))
    .map((r) => ({
      key: r.id,
      player: displayName(r.players),
      item: r.items?.name ?? 'Unknown Item',
      difficulty: difficultyOf(r.track),
      date: AWARD_DATE.format(new Date(r.awarded_at)),
      offSpec: isOffSpec(r.response)
    }));
}

export const mainSpecCount = (feed: FeedRow[]): number => feed.filter((r) => !r.offSpec).length;

// How many awards the feed shows before anyone searches.
export const PREVIEW = 10;

const normalise = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Searching matches an item name anywhere, ignoring case, and shows every
// match rather than the preview's first ten. There is no search by raider on
// purpose: one raider's loot history is not meant to be browsable (#99, #279).
export function searchFeed(feed: FeedRow[], query: string): FeedRow[] {
  const q = normalise(query);
  return q ? feed.filter((r) => normalise(r.item).includes(q)) : feed.slice(0, PREVIEW);
}
