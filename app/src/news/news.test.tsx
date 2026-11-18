import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Markdown } from '../lib/markdown';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { renderApp } from '../test/renderApp';
import * as formatting from './formatting';
import {
  groupByMonth,
  hasUnread,
  livePosts,
  matchesFilter,
  newestPost,
  olderPost,
  seenKey,
  slugify,
  uniqueSlug,
  unpublishedPosts,
  type NewsPost
} from './news';
import { SEEN_KEY } from './useNews';

// News as a blog (#1102, #1230): the rules, the formatting buttons, and the
// timeline, a post's page and Staff's editor. The pages are also checked in a
// browser from tests/browser-app/news.test.js.

const NOW = Date.parse('2026-11-17T12:00:00Z');

const post = (id: number, extra: Partial<NewsPost> = {}): NewsPost => ({
  id,
  slug: `post-${id}`,
  title: `Post ${id}`,
  category: 'Feature',
  summary: `About post ${id}.`,
  body: `Body of post ${id}.`,
  coverPath: null,
  coverCaption: null,
  version: null,
  pinned: false,
  publishedAt: '2026-09-07T16:00:00Z',
  ...extra
});

describe('news rules', () => {
  const POSTS = [
    post(1, { publishedAt: '2026-08-01T16:00:00Z' }),
    post(2, { publishedAt: '2026-09-07T16:00:00Z' }),
    post(3, { publishedAt: '2026-09-07T16:00:00Z' }),
    post(4, { publishedAt: null }),
    post(5, { publishedAt: '2999-01-01T00:00:00Z' })
  ];

  it('lists posts that are out newest first, a later-added post first on a shared day', () => {
    expect(livePosts(POSTS, NOW).map((p) => p.id)).toEqual([3, 2, 1]);
  });

  it('keeps drafts and posts dated later out of the list, and lists them for Staff', () => {
    expect(unpublishedPosts(POSTS, NOW).map((p) => p.id)).toEqual([5, 4]);
    expect(newestPost(POSTS, NOW)?.id).toBe(3);
    expect(newestPost([post(4, { publishedAt: null })], NOW)).toBeNull();
  });

  it('finds the next older post', () => {
    expect(olderPost(POSTS, POSTS[2]!, NOW)?.id).toBe(2);
    expect(olderPost(POSTS, POSTS[0]!, NOW)).toBeNull();
    expect(olderPost(POSTS, POSTS[3]!, NOW)).toBeNull();
  });

  it('groups by month in the order given, by the Eastern date', () => {
    const groups = groupByMonth(livePosts(POSTS, NOW));
    expect(groups.map((g) => [g.label, g.posts.map((p) => p.id)])).toEqual([
      ['September 2026', [3, 2]],
      ['August 2026', [1]]
    ]);
    // 2:00 a.m. UTC on Oct 1 is still Sep 30 in Eastern.
    expect(groupByMonth([post(9, { publishedAt: '2026-10-01T02:00:00Z' })])[0]?.label).toBe('September 2026');
  });

  it('filters by category and searches the title, summary and body', () => {
    const fix = post(6, { category: 'Fix', title: 'Wishlist saves', body: 'Slow connections no longer lose it.' });
    expect(matchesFilter(fix, 'All', '')).toBe(true);
    expect(matchesFilter(fix, 'Fix', '')).toBe(true);
    expect(matchesFilter(fix, 'Feature', '')).toBe(false);
    expect(matchesFilter(fix, 'All', 'WISHLIST')).toBe(true);
    expect(matchesFilter(fix, 'All', 'slow lose')).toBe(true);
    expect(matchesFilter(fix, 'All', 'calendar')).toBe(false);
  });

  it('has something new until the newest post out is the one seen, by version else address', () => {
    const withVersion = [post(1, { version: '3.1.0' })];
    expect(seenKey(withVersion[0]!)).toBe('3.1.0');
    expect(seenKey(post(2))).toBe('post-2');
    expect(hasUnread(withVersion, null, NOW)).toBe(true);
    expect(hasUnread(withVersion, '3.1.0', NOW)).toBe(false);
    // A draft is not news.
    expect(hasUnread([post(3, { publishedAt: null })], null, NOW)).toBe(false);
    expect(hasUnread([], null, NOW)).toBe(false);
  });

  it('makes an address from a title, numbered when it is taken, and never "new"', () => {
    expect(slugify('Raid Calendar: a day view for every raid night')).toBe(
      'raid-calendar-a-day-view-for-every-raid-night'
    );
    expect(slugify('  "Catalyst Only" hidden!  ')).toBe('catalyst-only-hidden');
    expect(slugify('New')).toBe('new-post');
    expect(slugify('???')).toBe('post');
    expect(slugify('a'.repeat(100))).toHaveLength(60);
    expect(uniqueSlug('Hello', new Set(['hello', 'hello-2']))).toBe('hello-3');
  });
});

describe('formatting buttons', () => {
  it('puts a heading on the line, and takes it off again', () => {
    expect(formatting.heading('Intro\nTitle\nMore', 7, 7)).toEqual({
      text: 'Intro\n## Title\nMore',
      start: 14,
      end: 14
    });
    expect(formatting.heading('## Title', 3, 3).text).toBe('Title');
  });

  it('makes a list of every line a selection touches, not the line below it', () => {
    expect(formatting.list('a\nb\nc', 0, 4)).toEqual({ text: '- a\n- b\nc', start: 0, end: 7 });
    expect(formatting.list('- a\n- b', 0, 7).text).toBe('a\nb');
  });

  it('wraps a selection in bold, or types the word to replace, or unwraps', () => {
    expect(formatting.bold('say hi now', 4, 6)).toEqual({ text: 'say **hi** now', start: 6, end: 8 });
    expect(formatting.bold('x', 1, 1)).toEqual({ text: 'x**bold**', start: 3, end: 7 });
    expect(formatting.bold('**hi**', 0, 6).text).toBe('hi');
  });

  it('makes a link with the address selected to paste over, or from a selected address', () => {
    const out = formatting.link('see docs', 4, 8);
    expect(out.text).toBe('see [docs](https://)');
    expect(out.text.slice(out.start, out.end)).toBe('https://');
    const pasted = formatting.link('https://example.com/x', 0, 21);
    expect(pasted.text).toBe('[link text](https://example.com/x)');
    expect(pasted.text.slice(pasted.start, pasted.end)).toBe('link text');
  });

  it('sets a picture on a paragraph of its own, with the word Caption selected to type over', () => {
    const out = formatting.picture('Before.After.', 7, 7, 'https://x.test/a.png', 'a [shot]');
    expect(out.text).toBe('Before.\n\n![a shot](https://x.test/a.png "Caption")\n\nAfter.');
    expect(out.text.slice(out.start, out.end)).toBe('Caption');
    expect(formatting.picture('', 0, 0, 'https://x.test/a.png', 'a').text).toBe('![a](https://x.test/a.png "Caption")');
  });
});

describe('Markdown in a post', () => {
  it('shows a picture only when pictures are on, and only from https or this machine', () => {
    const text =
      '![ok](https://x.test/a.png)\n\n![local](http://127.0.0.1:54321/a.png)\n\n![bad](http://evil.test/a.png)';
    const { container, rerender } = render(<Markdown text={text} pictures />);
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual(['ok', 'local']);
    rerender(<Markdown text={text} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('sets a picture on its own line as a figure, with its caption when it has one', () => {
    const { container } = render(
      <Markdown pictures text={'![a](https://x.test/a.png "The month view.")\n\n![b](https://x.test/b.png)'} />
    );
    const figures = [...container.querySelectorAll('figure')];
    expect(figures).toHaveLength(2);
    expect(figures[0]?.querySelector('figcaption')?.textContent).toBe('The month view.');
    expect(figures[0]?.querySelector('img')).toHaveAttribute('alt', 'a');
    expect(figures[1]?.querySelector('figcaption')).toBeNull();
    // Never a figure inside a paragraph.
    expect(container.querySelector('p figure')).toBeNull();
  });

  it('makes a heading line its own heading, at the level asked for', () => {
    render(<Markdown text={'## Open any night\nClick a day.'} headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Open any night' })).toBeInTheDocument();
    expect(screen.getByText('Click a day.')).toBeInTheDocument();
  });
});

// The rows news_posts answers with.
const row = (p: NewsPost) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  category: p.category,
  summary: p.summary,
  body: p.body,
  cover_path: p.coverPath,
  cover_caption: p.coverCaption,
  version: p.version,
  pinned: p.pinned,
  published_at: p.publishedAt
});

const POSTS = [
  post(1, {
    title: 'Report a BoE on one page',
    slug: 'report-a-boe',
    version: '3.88.0',
    publishedAt: '2026-09-03T16:00:00Z',
    pinned: true
  }),
  post(2, {
    title: 'Raid Calendar day view',
    slug: 'raid-calendar',
    version: '3.93.0',
    publishedAt: '2026-09-07T16:00:00Z',
    body: '## Open any night\n\nClick a day.\n\n- Your status\n- Everyone else',
    coverPath: 'cover.png',
    coverCaption: 'The month view.'
  }),
  post(3, { title: 'Catalyst Only hidden', slug: 'catalyst', category: 'Fix', publishedAt: '2026-08-18T16:00:00Z' }),
  post(4, { title: 'A draft', slug: 'a-draft', publishedAt: null }),
  post(5, { title: 'Scheduled one', slug: 'scheduled', publishedAt: '2999-01-01T16:00:00Z' })
];

const feed = (posts: NewsPost[]): FakeHandlers => {
  const base = seededHandlers();
  return {
    ...base,
    from: (read: Read) => (read.table === 'news_posts' ? { data: posts.map(row) } : base.from!(read))
  };
};

const asStaff = (handlers: FakeHandlers): FakeHandlers => ({
  ...handlers,
  session: fakeSession({ battlenet: 'Staff#1', discord: { id: 'discord-staff', name: 'Staff' } }),
  rpc: (name, args) =>
    name === 'current_discord_id'
      ? { data: 'discord-staff' }
      : name === 'resolve_person'
        ? { data: { site_admin: true, guild_officer: false, boe_manager: false, teams: [] } }
        : (handlers.rpc?.(name, args) ?? { data: null })
});

describe('News page', () => {
  beforeEach(() => localStorage.clear());

  it('shows the pinned post in its box, then the other posts by month, newest first', async () => {
    renderApp('/news', feed(POSTS));
    const pinned = await screen.findByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByText('Report a BoE on one page')).toBeInTheDocument();
    // A pinned post shows only there.
    expect(screen.getAllByText('Report a BoE on one page')).toHaveLength(1);
    const months = within(screen.getByRole('main'))
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(months).toEqual(['Pinned', 'September 2026', 'August 2026']);
    const link = screen.getByRole('link', { name: /Raid Calendar day view/ });
    expect(link).toHaveAttribute('href', '/news/raid-calendar');
  });

  it('filters by category and by search, and says when nothing matches', async () => {
    renderApp('/news', feed(POSTS));
    await screen.findByRole('link', { name: /Raid Calendar day view/ });
    await userEvent.click(screen.getByRole('button', { name: 'Fixes' }));
    expect(screen.getByRole('button', { name: 'Fixes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('link', { name: /Raid Calendar day view/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Catalyst Only hidden/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search news' }), 'month nothing');
    expect(await screen.findByText('No posts match.')).toBeInTheDocument();
  });

  it('marks the news seen, by the newest post’s version', async () => {
    renderApp('/news', feed(POSTS));
    await screen.findByRole('region', { name: 'Pinned' });
    expect(localStorage.getItem(SEEN_KEY)).toBe('3.93.0');
  });

  it('marks the News item on another page while there is something new', async () => {
    renderApp('/g/wga/t/phoenix', feed(POSTS));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'News, new' })).toBeInTheDocument();
  });

  it('says so when there is no news', async () => {
    renderApp('/news', feed([]));
    expect(await screen.findByText('No news yet.')).toBeInTheDocument();
  });

  it('shows New post and the unpublished posts to Staff only', async () => {
    const { view } = renderApp('/news', feed(POSTS));
    await screen.findByRole('link', { name: /Raid Calendar day view/ });
    expect(screen.queryByRole('link', { name: 'New post' })).not.toBeInTheDocument();
    expect(screen.queryByText('A draft')).not.toBeInTheDocument();
    view.unmount();

    renderApp('/news', asStaff(feed(POSTS)));
    expect(await screen.findByRole('link', { name: 'New post' })).toHaveAttribute('href', '/news/new');
    const unpublished = screen.getByRole('region', { name: 'Not published yet' });
    expect(within(unpublished).getByText('A draft')).toBeInTheDocument();
    expect(within(unpublished).getByText('Scheduled one')).toBeInTheDocument();
    // Neither is news: no mark for them.
    expect(localStorage.getItem(SEEN_KEY)).toBe('3.93.0');
  });
});

describe('A news post', () => {
  beforeEach(() => localStorage.clear());

  it('shows the post, its cover and body, and the next older post', async () => {
    renderApp('/news/raid-calendar', feed(POSTS));
    expect(await screen.findByRole('heading', { level: 1, name: 'Raid Calendar day view' })).toBeInTheDocument();
    expect(screen.getByText('Version 3.93.0')).toBeInTheDocument();
    expect(screen.getByText('Sep 7, 2026', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('About post 2.')).toBeInTheDocument();
    expect(screen.getByText('The month view.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Open any night' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'Your status' })])
    );
    expect(screen.getByRole('link', { name: 'All news' })).toHaveAttribute('href', '/news');
    expect(screen.getByRole('link', { name: 'Older: Report a BoE on one page' })).toHaveAttribute(
      'href',
      '/news/report-a-boe'
    );
    // Reading the newest post counts as seeing the news.
    expect(localStorage.getItem(SEEN_KEY)).toBe('3.93.0');
    // Staff's buttons are not shown to a reader.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('lists the five newest other posts beside it, never the one being read', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      post(i + 1, { publishedAt: `2026-08-0${i + 1}T16:00:00Z`, title: `Entry ${i + 1}`, slug: `entry-${i + 1}` })
    );
    renderApp('/news/entry-8', feed(many));
    const recent = await screen.findByRole('complementary', { name: 'Recent news' });
    expect(
      within(recent)
        .getAllByRole('link')
        .map((a) => a.textContent)
    ).toEqual(['Entry 7Aug 7', 'Entry 6Aug 6', 'Entry 5Aug 5', 'Entry 4Aug 4', 'Entry 3Aug 3']);
    expect(within(recent).getAllByRole('link')[0]).toHaveAttribute('href', '/news/entry-7');
  });

  it('leaves the list out when there is no other post', async () => {
    renderApp('/news/post-1', feed([post(1)]));
    await screen.findByRole('heading', { level: 1, name: 'Post 1' });
    expect(screen.queryByRole('complementary', { name: 'Recent news' })).not.toBeInTheDocument();
  });

  it('says so for an address with no post', async () => {
    renderApp('/news/nothing-here', feed(POSTS));
    expect(await screen.findByRole('heading', { level: 1, name: 'Post not found' })).toBeInTheDocument();
  });

  it('gives Staff Edit and Delete, and Delete asks first', async () => {
    const { client, router } = renderApp('/news/raid-calendar', asStaff(feed(POSTS)));
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/news/raid-calendar/edit');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this post?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(client.writes).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/news'));
    expect(client.writes).toEqual([
      { table: 'news_posts', method: 'delete', values: undefined, filters: [['eq', 'id', 2]] }
    ]);
  });

  it('tells Staff a draft is not out yet', async () => {
    renderApp('/news/a-draft', asStaff(feed(POSTS)));
    expect(await screen.findByRole('note')).toHaveTextContent('A draft. Only Staff can see it');
  });
});

describe('Writing a post', () => {
  it('is for Staff', async () => {
    renderApp('/news/new', feed(POSTS));
    expect(await screen.findByText('Sign in to see this page. It is for Staff.')).toBeInTheDocument();
  });

  it('refuses a post with no title or summary, saying why', async () => {
    const { client } = renderApp('/news/new', asStaff(feed(POSTS)));
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(screen.getByText('Give the post a title.')).toBeInTheDocument();
    expect(screen.getByText('Add a one-line summary for the list.')).toBeInTheDocument();
    expect(client.writes).toEqual([]);
  });

  it('previews as you type, and the formatting buttons type for you', async () => {
    renderApp('/news/new', asStaff(feed(POSTS)));
    const box = await screen.findByRole('textbox', { name: 'Post' });
    await userEvent.type(box, 'Intro');
    await userEvent.click(screen.getByRole('button', { name: 'Heading' }));
    expect(box).toHaveValue('## Intro');
    expect(screen.getByRole('heading', { level: 2, name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('publishes a new post at an address from its title, signed by the database', async () => {
    const { client, router } = renderApp('/news/new', asStaff(feed(POSTS)));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Brand new thing');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Announcement');
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary, shown in the list' }), 'It is new.');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pin to the top of News' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Post' }), 'Hello.');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/news/brand-new-thing'));
    expect(client.writes).toHaveLength(1);
    const write = client.writes[0]!;
    expect(write.table).toBe('news_posts');
    expect(write.method).toBe('insert');
    expect(write.values).toMatchObject({
      slug: 'brand-new-thing',
      title: 'Brand new thing',
      category: 'Announcement',
      summary: 'It is new.',
      body: 'Hello.',
      pinned: true,
      cover_path: null
    });
    expect(Date.parse((write.values as { published_at: string }).published_at)).toBeLessThanOrEqual(Date.now());
    // The author is the database's to set.
    expect(write.values).not.toHaveProperty('written_by');
  });

  it('saves a draft with no date, and numbers an address another post has', async () => {
    const { client } = renderApp('/news/new', asStaff(feed(POSTS)));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'A draft');
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary, shown in the list' }), 'Soon.');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(client.writes).toHaveLength(1));
    expect(client.writes[0]!.values).toMatchObject({ slug: 'a-draft-2', published_at: null });
  });

  it('edits a post in place: its address and date stay, and the author is never sent', async () => {
    const { client, router } = renderApp('/news/raid-calendar/edit', asStaff(feed(POSTS)));
    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Raid Calendar day view');
    expect(screen.getByRole('textbox', { name: 'Cover caption (optional)' })).toHaveValue('The month view.');
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    await userEvent.clear(title);
    await userEvent.type(title, 'Raid Calendar, reworded');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/news/raid-calendar'));
    const write = client.writes[0]!;
    expect(write).toMatchObject({ method: 'update', filters: [['eq', 'id', 2]] });
    expect(write.values).toMatchObject({
      title: 'Raid Calendar, reworded',
      published_at: '2026-09-07T16:00:00Z',
      cover_path: 'cover.png'
    });
    expect(write.values).not.toHaveProperty('slug');
    expect(write.values).not.toHaveProperty('written_by');
  });

  it('removes the cover picture and its caption', async () => {
    const { client } = renderApp('/news/raid-calendar/edit', asStaff(feed(POSTS)));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove it' }));
    expect(screen.queryByRole('textbox', { name: 'Cover caption (optional)' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(client.writes).toHaveLength(1));
    expect(client.writes[0]!.values).toMatchObject({ cover_path: null, cover_caption: null });
  });
});
