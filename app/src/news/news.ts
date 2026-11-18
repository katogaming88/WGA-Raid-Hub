import { easternDate, isoDateLong, isoDateShort, monthLabel } from '../lib/dates';
// The News page's rules (#1102, #1230): which posts are out, the order they
// are listed in, how a reader narrows them, and whether there is anything the
// reader has not seen. The rules the current site's js/news.js followed
// (newest first, a pin, a "something new" mark) are recorded against it in
// tests/behavior/news.js; the posts themselves are rows of news_posts now.

export type NewsCategory = 'Feature' | 'Fix' | 'Change' | 'Announcement';
export const NEWS_CATEGORIES: readonly NewsCategory[] = ['Feature', 'Fix', 'Change', 'Announcement'];

// One news_posts row, as the pages use it.
export type NewsPost = {
  id: number;
  slug: string;
  title: string;
  category: string;
  summary: string;
  // Simple formatting: ## headings, **bold**, - lists, links and pictures.
  body: string;
  // A path in the news-pictures bucket.
  coverPath: string | null;
  coverCaption: string | null;
  version: string | null;
  pinned: boolean;
  // null is a draft; a later date waits until then (the database shows
  // either only to Staff).
  publishedAt: string | null;
};

// Out for everyone: a date that has come.
export const isLive = (post: NewsPost, now: number): boolean =>
  post.publishedAt !== null && Date.parse(post.publishedAt) <= now;

// Newest first; two posts on one day go the way they were added, the later
// one first.
const newestFirst = (a: NewsPost, b: NewsPost) =>
  Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || b.id - a.id;

export const livePosts = (posts: NewsPost[], now: number): NewsPost[] =>
  posts.filter((p) => isLive(p, now)).sort(newestFirst);

// What only Staff are shown: drafts and posts dated later, the last-added first.
export const unpublishedPosts = (posts: NewsPost[], now: number): NewsPost[] =>
  posts.filter((p) => !isLive(p, now)).sort((a, b) => b.id - a.id);

export const newestPost = (posts: NewsPost[], now: number): NewsPost | null => livePosts(posts, now)[0] ?? null;

// The next older post, for the link at the bottom of a post.
export function olderPost(posts: NewsPost[], post: NewsPost, now: number): NewsPost | null {
  const live = livePosts(posts, now);
  const at = live.findIndex((p) => p.id === post.id);
  return at >= 0 ? (live[at + 1] ?? null) : null;
}

export type NewsFilter = 'All' | NewsCategory;

// A category filter and a search, which looks in the title, the summary and
// the post itself.
export function matchesFilter(post: NewsPost, filter: NewsFilter, search: string): boolean {
  if (filter !== 'All' && post.category !== filter) return false;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${post.title} ${post.summary} ${post.body}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

// The Eastern calendar date a post went out on: posts belong to the guild's
// calendar, so it reads the same for everyone.
export const postDate = (post: NewsPost): string => (post.publishedAt ? easternDate(post.publishedAt) : '');

// "September 2026" groups, in the order the posts come.
export function groupByMonth(posts: NewsPost[]): { key: string; label: string; posts: NewsPost[] }[] {
  const groups: { key: string; label: string; posts: NewsPost[] }[] = [];
  for (const post of posts) {
    const key = postDate(post).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.posts.push(post);
    } else {
      const [year, month] = key.split('-').map(Number);
      groups.push({ key, label: monthLabel(year ?? 0, (month ?? 1) - 1), posts: [post] });
    }
  }
  return groups;
}

// The mark of what a reader last saw, kept in the browser. It is the post's
// version when it has one, which is what the current site kept (the copied
// entries carry theirs, so the mark carries over at cutover), else its address.
export const seenKey = (post: NewsPost): string => post.version ?? post.slug;

// Something new: the newest out post is not the one the reader last saw.
export function hasUnread(posts: NewsPost[], lastSeen: string | null, now: number): boolean {
  const newest = newestPost(posts, now);
  return newest !== null && seenKey(newest) !== lastSeen;
}

// A post's address from its title: lowercase words joined by hyphens, which
// is the shape the database accepts. "new" is the editor's own address.
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug && slug !== 'new' ? slug : slug ? 'new-post' : 'post';
}

// slugify(), numbered when another post already has the address.
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

// "Sep 7, 2026", or the date as written when it is not YYYY-MM-DD.
export const newsDate = isoDateLong;

// "Sep 7", for the short list on Guild home.
export const newsShortDate = isoDateShort;

export const categoryKind = (category: string): 'feature' | 'fix' | 'change' | 'announcement' | 'other' =>
  category === 'Feature'
    ? 'feature'
    : category === 'Fix'
      ? 'fix'
      : category === 'Change'
        ? 'change'
        : category === 'Announcement'
          ? 'announcement'
          : 'other';

// The filter row's buttons: the plural reads better than the stored word.
export const FILTERS: readonly { value: NewsFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Feature', label: 'Features' },
  { value: 'Fix', label: 'Fixes' },
  { value: 'Change', label: 'Changes' },
  { value: 'Announcement', label: 'Announcements' }
];
