import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { Icon } from '../components/Icon';
import { useSupabase } from '../data/DataProvider';
import {
  FILTERS,
  categoryKind,
  groupByMonth,
  livePosts,
  matchesFilter,
  newsDate,
  newsShortDate,
  postDate,
  seenKey,
  unpublishedPosts,
  type NewsFilter,
  type NewsPost
} from './news';
import { newsPictureUrl, useNews, useNewsSeen, useNow } from './useNews';
import './news.css';

// The News page (#1102, #1230): what shipped on the site, written by Staff on
// the site itself. Pinned posts in a box at the top, then every post as a
// timeline by month with a category filter and a search. A post opens on its
// own page (NewsPostPage).
export function NewsPage() {
  const news = useNews();
  const { can } = usePageCan();
  const staff = can('adminSite');

  return (
    <section className="page news-page" aria-labelledby="page-title">
      <div className="page-header news-header">
        <div>
          <h1 id="page-title">News</h1>
          <p className="text-muted page-subtitle">What’s new on the site. Each post opens on its own page.</p>
        </div>
        {staff && (
          <Link className="button button-primary" to="/news/new">
            New post
          </Link>
        )}
      </div>
      <DataState query={news} label="the news">
        {(posts) => <NewsTimeline posts={posts} staff={staff} />}
      </DataState>
    </section>
  );
}

export function CategoryLabel({ category }: { category: string }) {
  return <span className={`news-category news-category-${categoryKind(category)}`}>{category}</span>;
}

function NewsTimeline({ posts, staff }: { posts: NewsPost[]; staff: boolean }) {
  const now = useNow();
  const [filter, setFilter] = useState<NewsFilter>('All');
  const [search, setSearch] = useState('');
  const searchId = useId();
  const [, markSeen] = useNewsSeen();

  const live = livePosts(posts, now);
  const newest = live[0] ?? null;
  const newestMark = newest ? seenKey(newest) : null;
  // Opening News counts as seeing everything on it.
  useEffect(() => {
    if (newestMark) markSeen(newestMark);
  }, [newestMark, markSeen]);

  // A pinned post shows only in the box; unpinned, it goes back to its month.
  const pinned = live.filter((p) => p.pinned);
  const shown = live.filter((p) => !p.pinned && matchesFilter(p, filter, search));
  const unpublished = staff ? unpublishedPosts(posts, now) : [];

  if (!live.length && !unpublished.length) return <p className="text-muted">No news yet.</p>;

  return (
    <>
      {unpublished.length > 0 && <Unpublished posts={unpublished} now={now} />}

      {pinned.length > 0 && (
        <section className="news-pinned" aria-labelledby="news-pinned-title">
          <h2 id="news-pinned-title" className="news-pinned-title">
            <Icon name="pin" size={14} />
            Pinned
          </h2>
          {pinned.map((post) => (
            <PinnedPost key={post.id} post={post} />
          ))}
        </section>
      )}

      <div className="news-controls">
        <div role="group" aria-label="Category" className="news-filters">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className="news-filter"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="news-search">
          <label htmlFor={searchId} className="visually-hidden">
            Search news
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            placeholder="Search news"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted news-none">No posts match.</p>
      ) : (
        groupByMonth(shown).map((month) => (
          <section key={month.key} className="news-month" aria-labelledby={`news-month-${month.key}`}>
            <h2 id={`news-month-${month.key}`} className="news-month-title">
              {month.label}
            </h2>
            <ul className="news-items">
              {month.posts.map((post) => (
                <li key={post.id}>
                  <Link className="news-item" to={`/news/${post.slug}`}>
                    <time className="news-item-day" dateTime={postDate(post)}>
                      {newsShortDate(postDate(post))}
                    </time>
                    <span className="news-item-main">
                      <CategoryLabel category={post.category} />
                      <span className="news-item-title">{post.title}</span>
                      <span className="news-item-summary">{post.summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function PinnedPost({ post }: { post: NewsPost }) {
  const client = useSupabase();
  return (
    <Link className="news-pinned-post" to={`/news/${post.slug}`}>
      {post.coverPath && <img className="news-pinned-cover" src={newsPictureUrl(client, post.coverPath)} alt="" />}
      <span className="news-pinned-text">
        <span className="news-item-meta">
          <CategoryLabel category={post.category} />
          <time dateTime={postDate(post)}>{newsDate(postDate(post))}</time>
        </span>
        <span className="news-pinned-heading">{post.title}</span>
        <span className="news-item-summary">{post.summary}</span>
      </span>
    </Link>
  );
}

// Drafts and posts dated later: only Staff are given them.
function Unpublished({ posts, now }: { posts: NewsPost[]; now: number }) {
  return (
    <section className="news-unpublished" aria-labelledby="news-unpublished-title">
      <h2 id="news-unpublished-title" className="news-month-title">
        Not published yet
      </h2>
      <ul className="news-items">
        {posts.map((post) => (
          <li key={post.id}>
            <Link className="news-item" to={`/news/${post.slug}`}>
              <span className="news-item-day">
                {post.publishedAt && Date.parse(post.publishedAt) > now ? newsShortDate(postDate(post)) : 'Draft'}
              </span>
              <span className="news-item-main">
                <CategoryLabel category={post.category} />
                <span className="news-item-title">{post.title}</span>
                <span className="news-item-summary">
                  {post.publishedAt ? `Goes out ${newsDate(postDate(post))}.` : 'A draft, only Staff can see it.'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
