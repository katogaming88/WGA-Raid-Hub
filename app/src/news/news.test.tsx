import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { hasUnread, newestEntry, newsDate, openByDefault, sortNews, type NewsEntry } from './news';
import { SEEN_KEY } from './useNews';

// The News page (#1102). The same behavior is checked in a browser against
// both sites from tests/behavior/news.js; these cover the rules and the page.

const entry = (version: string, date: string, extra: Partial<NewsEntry> = {}): NewsEntry => ({
  version,
  date,
  category: 'Feature',
  title: `Entry ${version}`,
  body: `Body ${version}`,
  ...extra
});

const ENTRIES = [
  entry('1.0', '2026-08-01'),
  entry('0.5', '2026-01-01', { pinned: true, category: 'Change' }),
  entry('2.0', '2026-09-07'),
  entry('1.9', '2026-09-07', { category: 'Fix' })
];

describe('news rules', () => {
  it('lists pinned entries first, then newest, keeping file order on a shared date', () => {
    expect(sortNews(ENTRIES).map((e) => e.version)).toEqual(['0.5', '2.0', '1.9', '1.0']);
  });

  it('finds the newest entry by date, not by position', () => {
    expect(newestEntry(ENTRIES)?.version).toBe('2.0');
    expect(newestEntry([])).toBeNull();
  });

  it('opens pinned entries and the newest one', () => {
    const newest = newestEntry(ENTRIES);
    expect(ENTRIES.filter((e) => openByDefault(e, newest)).map((e) => e.version)).toEqual(['0.5', '2.0']);
  });

  it('has something new until the newest version is the one seen', () => {
    expect(hasUnread(ENTRIES, null)).toBe(true);
    expect(hasUnread(ENTRIES, '1.9')).toBe(true);
    expect(hasUnread(ENTRIES, '2.0')).toBe(false);
    expect(hasUnread([], null)).toBe(false);
  });

  it('writes dates out, and leaves anything else as written', () => {
    expect(newsDate('2026-09-07')).toBe('Sep 7, 2026');
    expect(newsDate('Autumn')).toBe('Autumn');
  });
});

describe('News page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ENTRIES), { headers: { 'Content-Type': 'application/json' } }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens and closes an entry from its header, and marks the news seen', async () => {
    renderApp('/g/wga/news');
    const header = await screen.findByRole('button', { name: /Entry 1\.0/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Entry 2\.0/ })).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem(SEEN_KEY)).toBe('2.0');
    // The sidebar's mark is gone once the page has been opened.
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'News' })).toBeInTheDocument();
  });

  it('marks the News item on another page while there is something new', async () => {
    renderApp('/g/wga/t/phoenix');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'News, new' })).toBeInTheDocument();
  });

  it('says so when there is no news', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]'))
    );
    renderApp('/g/wga/news');
    expect(await screen.findByText('No news yet.')).toBeInTheDocument();
  });
});
