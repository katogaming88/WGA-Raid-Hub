import { useEffect, useId, useState } from 'react';
import { DataState } from '../components/DataState';
import { Icon } from '../components/Icon';
import { categoryKind, newestEntry, newsDate, openByDefault, sortNews, type NewsEntry } from './news';
import { useNews, useNewsSeen } from './useNews';
import './news.css';

// The News page (#1102): what shipped on the site, newest first, checked
// against the current site's News tab in tests/browser-app/news.test.js.
export function NewsPage() {
  const news = useNews();

  return (
    <section className="page news-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">News</h1>
        <p className="text-muted page-subtitle">What’s new on the site.</p>
      </div>
      <DataState query={news} label="the news">
        {(entries) => <NewsList entries={entries} />}
      </DataState>
    </section>
  );
}

function NewsList({ entries }: { entries: NewsEntry[] }) {
  const [, markSeen] = useNewsSeen();
  const newest = newestEntry(entries);
  // Opening News counts as seeing everything on it.
  useEffect(() => {
    if (newest) markSeen(newest.version);
  }, [newest, markSeen]);
  // The reader's own open and close choices, by version.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  if (!entries.length) return <p className="text-muted">No news yet.</p>;

  return (
    <ol className="news-list">
      {sortNews(entries).map((entry) => {
        const open = toggled[entry.version] ?? openByDefault(entry, newest);
        return (
          <li key={entry.version}>
            <NewsItem
              entry={entry}
              open={open}
              onToggle={() => setToggled((t) => ({ ...t, [entry.version]: !open }))}
            />
          </li>
        );
      })}
    </ol>
  );
}

function NewsItem({ entry, open, onToggle }: { entry: NewsEntry; open: boolean; onToggle: () => void }) {
  const bodyId = useId();
  return (
    <article className={`card news-entry${entry.pinned ? ' news-entry-pinned' : ''}`} data-open={open}>
      <h2 className="news-entry-heading">
        <button
          type="button"
          className="news-entry-header"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="news-entry-meta">
            {entry.pinned && <span className="news-pinned">Pinned</span>}
            <time className="news-entry-date" dateTime={entry.date}>
              {newsDate(entry.date)}
            </time>
            <span className={`news-category news-category-${categoryKind(entry.category)}`}>{entry.category}</span>
            <span className="news-entry-version text-dim">v{entry.version}</span>
          </span>
          <span className="news-entry-title">{entry.title}</span>
          <Icon name="chevronDown" size={16} />
        </button>
      </h2>
      {/* Always in the page so it can slide; closed, it is hidden from
          everyone and out of the tab order. */}
      <div id={bodyId} className="news-entry-body-wrap" inert={!open}>
        <div className="news-entry-body-inner">
          <p className="news-entry-body">{entry.body}</p>
        </div>
      </div>
    </article>
  );
}
