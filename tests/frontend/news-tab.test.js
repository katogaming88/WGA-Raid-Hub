import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #509: lightweight raider-facing "News" tab, reading a static news.json
// (not Supabase, not team-scoped) rather than anything derived from
// CHANGELOG.md. Loads the real js/news.js on top of common.js (for _esc), same
// vm-sandbox pattern as the rest of this suite.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const NEWS_JS = readFileSync(path.join(HERE, '../../js/news.js'), 'utf8');

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '' }, extra);
}

function loadSandbox({ els = {}, fetchImpl, localStorageBacking } = {}) {
  const allEls = { ...els };
  const store = localStorageBacking || {};
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      }
    },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      }
    },
    fetch: fetchImpl || (() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(NEWS_JS, sandbox, { filename: 'news.js' });
  return { sandbox, els: allEls, store };
}

function entry(overrides) {
  return {
    date: '2026-07-20',
    category: 'Feature',
    version: '3.46.0',
    title: 'Example title',
    body: 'Example body.',
    ...overrides
  };
}

describe('sortNewsNewestFirst', () => {
  it('sorts by date descending regardless of input order', () => {
    const { sandbox } = loadSandbox({});
    const sorted = sandbox.sortNewsNewestFirst([
      entry({ date: '2026-01-01', title: 'old' }),
      entry({ date: '2026-07-20', title: 'newest' }),
      entry({ date: '2026-03-15', title: 'middle' })
    ]);
    expect(sorted.map((e) => e.title)).toEqual(['newest', 'middle', 'old']);
  });

  it('resolves to an empty array for null/empty input', () => {
    const { sandbox } = loadSandbox({});
    expect(sandbox.sortNewsNewestFirst(null)).toEqual([]);
    expect(sandbox.sortNewsNewestFirst([])).toEqual([]);
  });

  it('puts a pinned entry first even when it is older than everything else', () => {
    const { sandbox } = loadSandbox({});
    const sorted = sandbox.sortNewsNewestFirst([
      entry({ date: '2026-07-20', title: 'newest' }),
      entry({ date: '2026-01-01', title: 'old pinned', pinned: true }),
      entry({ date: '2026-03-15', title: 'middle' })
    ]);
    expect(sorted.map((e) => e.title)).toEqual(['old pinned', 'newest', 'middle']);
  });
});

describe('latestNewsEntry', () => {
  it('picks the chronologically newest entry even if a pin sorts it below an older pinned one', () => {
    const { sandbox } = loadSandbox({});
    sandbox.NEWS_DATA = sandbox.sortNewsNewestFirst([
      entry({ date: '2026-01-01', version: '3.40.0', title: 'old pinned', pinned: true }),
      entry({ date: '2026-07-20', version: '3.46.0', title: 'actually newest' })
    ]);
    expect(sandbox.latestNewsEntry().title).toBe('actually newest');
  });

  it('returns null when there is no news', () => {
    const { sandbox } = loadSandbox({});
    sandbox.NEWS_DATA = [];
    expect(sandbox.latestNewsEntry()).toBeNull();
  });
});

describe('loadNews', () => {
  it('fetches news.json and stores it sorted newest-first', async () => {
    const rows = [entry({ date: '2026-01-01', title: 'old' }), entry({ date: '2026-07-20', title: 'new' })];
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) }));
    const { sandbox } = loadSandbox({ fetchImpl });
    await sandbox.loadNews();
    expect(fetchImpl).toHaveBeenCalledWith('news.json');
    expect(sandbox.NEWS_DATA.map((e) => e.title)).toEqual(['new', 'old']);
  });

  it('resolves to an empty list on a fetch error instead of throwing', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network down')));
    const { sandbox } = loadSandbox({ fetchImpl });
    await sandbox.loadNews();
    expect(sandbox.NEWS_DATA).toEqual([]);
  });

  it('resolves to an empty list when the response is not ok', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false }));
    const { sandbox } = loadSandbox({ fetchImpl });
    await sandbox.loadNews();
    expect(sandbox.NEWS_DATA).toEqual([]);
  });
});

describe('renderNewsList / buildNewsTab', () => {
  it('shows an empty-state message when there is no news', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    sandbox.NEWS_DATA = [];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).toContain('No news yet.');
  });

  it('renders one collapsed entry per row with date/category/version/title, no body', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    // Two entries so the older, non-latest one under test isn't auto-expanded
    // by the "latest entry defaults open" rule.
    sandbox.NEWS_DATA = [
      entry({ version: '3.47.0', date: '2026-07-21', title: 'Newer', body: 'Newer body.' }),
      entry({ version: '3.46.0', date: '2026-07-20', title: 'My Feature', body: 'My Feature body.' })
    ];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).toContain('My Feature');
    expect(els.newsView.innerHTML).toContain('Feature');
    expect(els.newsView.innerHTML).toContain('3.46.0');
    expect(els.newsView.innerHTML).not.toContain('My Feature body.');
  });

  it('toggleNewsEntry expands the clicked entry to show its body, and collapses it again on a second click', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    // Two entries so the one being toggled isn't the sole/latest entry, which
    // would otherwise start open by default and defeat this assertion.
    sandbox.NEWS_DATA = [
      entry({ version: '3.46.0', date: '2026-07-20', body: 'Newer entry body.' }),
      entry({ version: '3.45.0', date: '2026-07-19', body: 'Full write-up here.' })
    ];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).not.toContain('Full write-up here.');
    sandbox.toggleNewsEntry(1);
    expect(els.newsView.innerHTML).toContain('Full write-up here.');
    sandbox.toggleNewsEntry(1);
    expect(els.newsView.innerHTML).not.toContain('Full write-up here.');
  });

  it('auto-expands a pinned entry by default, without needing a click', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    sandbox.NEWS_DATA = sandbox.sortNewsNewestFirst([
      entry({ version: '3.40.0', date: '2026-01-01', title: 'pinned', body: 'Pinned body.', pinned: true }),
      entry({ version: '3.46.0', date: '2026-07-20', title: 'newest', body: 'Newest body.' })
    ]);
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).toContain('Pinned body.');
  });

  it('auto-expands the single chronologically latest entry by default, even if unpinned', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    sandbox.NEWS_DATA = [
      entry({ version: '3.46.0', date: '2026-07-20', title: 'newest', body: 'Newest body.' }),
      entry({ version: '3.45.0', date: '2026-07-19', title: 'older', body: 'Older body.' })
    ];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).toContain('Newest body.');
    expect(els.newsView.innerHTML).not.toContain('Older body.');
  });

  it('a click can still collapse a pinned or default-latest entry, overriding the default', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    sandbox.NEWS_DATA = [entry({ version: '3.46.0', date: '2026-07-20', body: 'Newest body.', pinned: true })];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).toContain('Newest body.');
    sandbox.toggleNewsEntry(0);
    expect(els.newsView.innerHTML).not.toContain('Newest body.');
  });

  it('escapes HTML-significant characters in title/body (raider-authored content is trusted here, but the pattern is still defended)', () => {
    const els = { newsView: makeEl() };
    const { sandbox } = loadSandbox({ els });
    // A sole entry auto-expands (it's the latest by default), so its body
    // renders without needing an explicit toggleNewsEntry() call here.
    sandbox.NEWS_DATA = [entry({ title: '<img src=x onerror=alert(1)>', body: '<script>alert(2)</script>' })];
    sandbox.buildNewsTab();
    expect(els.newsView.innerHTML).not.toContain('<img src=x onerror=alert(1)>');
    expect(els.newsView.innerHTML).not.toContain('<script>alert(2)</script>');
  });
});

describe('unread red-dot badge', () => {
  it('shows the dot when the newest entry has a version not yet seen', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox } = loadSandbox({ els, localStorageBacking: { wga_news_last_seen: '3.45.0' } });
    sandbox.NEWS_DATA = [entry({ version: '3.46.0' })];
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('');
  });

  it('tracks the chronologically latest entry, not index 0, when an older pin sorts to the top (#regression)', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox } = loadSandbox({ els, localStorageBacking: { wga_news_last_seen: '3.45.0' } });
    sandbox.NEWS_DATA = sandbox.sortNewsNewestFirst([
      entry({ version: '3.40.0', date: '2026-01-01', pinned: true }),
      entry({ version: '3.46.0', date: '2026-07-20' })
    ]);
    expect(sandbox.NEWS_DATA[0].pinned).toBe(true); // sanity: the pin is at index 0
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('');

    sandbox.markNewsSeen();
    expect(sandbox.getNewsLastSeen()).toBe('3.46.0');
    expect(els.navNewsDot.style.display).toBe('none');
  });

  it('hides the dot once the newest entry version matches the last-seen version', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox } = loadSandbox({ els, localStorageBacking: { wga_news_last_seen: '3.46.0' } });
    sandbox.NEWS_DATA = [entry({ version: '3.46.0' })];
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('none');
  });

  it('shows the dot for a same-day entry with a new version, even though the seen date is identical (#regression)', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox } = loadSandbox({ els, localStorageBacking: { wga_news_last_seen: '3.46.0' } });
    sandbox.NEWS_DATA = [entry({ date: '2026-07-20', version: '3.47.0' })];
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('');
  });

  it('hides the dot when there is no news at all', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox } = loadSandbox({ els });
    sandbox.NEWS_DATA = [];
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('none');
  });

  it('markNewsSeen records the newest version and hides the dot', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox, store } = loadSandbox({ els });
    sandbox.NEWS_DATA = [entry({ version: '3.46.0' })];
    sandbox.updateNewsNavItem();
    expect(els.navNewsDot.style.display).toBe('');

    sandbox.markNewsSeen();
    expect(store['wga_news_last_seen']).toBe('3.46.0');
    expect(els.navNewsDot.style.display).toBe('none');
  });

  it('markNewsSeen does nothing when there is no news yet', () => {
    const els = { navNewsDot: makeEl() };
    const { sandbox, store } = loadSandbox({ els });
    sandbox.NEWS_DATA = [];
    sandbox.markNewsSeen();
    expect(store['wga_news_last_seen']).toBeUndefined();
  });
});
