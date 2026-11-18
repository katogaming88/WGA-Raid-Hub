import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useSupabase } from '../data/DataProvider';
import { errorMessage } from '../lib/errors';
import { Markdown } from '../lib/markdown';
import { CategoryLabel } from './NewsPage';
import {
  isLive,
  livePosts,
  newestPost,
  newsDate,
  newsShortDate,
  olderPost,
  postDate,
  seenKey,
  type NewsPost
} from './news';
import { newsPictureUrl, useDeleteNewsPost, useNews, useNewsSeen, useNow } from './useNews';
import './news.css';

// One news post on its own page, at /news/<address>, so it can be linked from
// Discord (#1230).
export function NewsPostPage() {
  const { slug } = useParams();
  const news = useNews();
  return (
    <DataState query={news} label="the post">
      {(posts) => {
        const post = posts.find((p) => p.slug === slug);
        return post ? <PostView posts={posts} post={post} /> : <PostNotFound />;
      }}
    </DataState>
  );
}

export function PostNotFound() {
  return (
    <section className="page news-page" aria-labelledby="page-title">
      <h1 id="page-title">Post not found</h1>
      <p className="text-muted">There is no news post at this address. It may have been taken down.</p>
      <p>
        <Link to="/news">All news</Link>
      </p>
    </section>
  );
}

function PostView({ posts, post }: { posts: NewsPost[]; post: NewsPost }) {
  const client = useSupabase();
  const navigate = useNavigate();
  const { announce } = useStatus();
  const { can } = usePageCan();
  const staff = can('adminSite');
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteNewsPost(() => {
    announce('success', 'Post deleted.');
    void navigate('/news');
  });
  const [, markSeen] = useNewsSeen();

  // Reading the newest post counts as seeing the news.
  const newest = newestPost(posts, now);
  const isNewest = newest?.id === post.id;
  const mark = newest ? seenKey(newest) : null;
  useEffect(() => {
    if (isNewest && mark) markSeen(mark);
  }, [isNewest, mark, markSeen]);

  const older = olderPost(posts, post, now);
  const date = postDate(post);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      announce('success', 'Link copied.');
    } catch {
      announce('error', 'Couldn’t copy the link. Copy it from the address bar.');
    }
  };

  return (
    <div className="page news-post-layout">
      <article className="news-post" aria-labelledby="page-title">
        <div className="news-post-bar">
          <Link to="/news">All news</Link>
          <div className="news-post-actions">
            <button type="button" className="button" onClick={() => void copyLink()}>
              Copy link
            </button>
            {staff && (
              <>
                <Link className="button" to={`/news/${post.slug}/edit`}>
                  Edit
                </Link>
                <button type="button" className="button" onClick={() => setConfirming(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
        {!isLive(post, now) && (
          <p className="news-draft-note" role="note">
            {post.publishedAt
              ? `Goes out ${newsDate(date)}. Until then only Staff can see it.`
              : 'A draft. Only Staff can see it until it is published.'}
          </p>
        )}
        <div className="news-item-meta">
          <CategoryLabel category={post.category} />
          {date && <time dateTime={date}>{newsDate(date)}</time>}
          {post.version && <span>Version {post.version}</span>}
        </div>
        <h1 id="page-title" className="news-post-title">
          {post.title}
        </h1>
        <p className="news-post-summary">{post.summary}</p>
        {post.coverPath && (
          <figure className="news-cover">
            <img src={newsPictureUrl(client, post.coverPath)} alt="" />
            {post.coverCaption && <figcaption>{post.coverCaption}</figcaption>}
          </figure>
        )}
        <div className="news-body">
          <Markdown text={post.body} pictures headingLevel={2} />
        </div>
        {older && (
          <footer className="news-post-footer">
            <Link to={`/news/${older.slug}`}>Older: {older.title}</Link>
          </footer>
        )}
        {confirming && (
          <Dialog title="Delete this post?" onClose={() => setConfirming(false)} busy={remove.isPending}>
            <p>“{post.title}” will be gone for everyone, and its address stops working. This can’t be undone.</p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setConfirming(false)} disabled={remove.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(post.id, {
                    onError: (error) => {
                      setConfirming(false);
                      announce('error', errorMessage(error));
                    }
                  })
                }
              >
                {remove.isPending ? 'Deleting…' : 'Delete post'}
              </button>
            </div>
          </Dialog>
        )}
      </article>
      <RecentNews posts={posts} current={post} now={now} />
    </div>
  );
}

// The five newest other posts, beside the post on a wide screen (and under it
// on a narrow one), so a reader has somewhere to go next.
const RECENT = 5;

function RecentNews({ posts, current, now }: { posts: NewsPost[]; current: NewsPost; now: number }) {
  const recent = livePosts(posts, now)
    .filter((p) => p.id !== current.id)
    .slice(0, RECENT);
  if (!recent.length) return null;
  return (
    <aside className="news-recent" aria-labelledby="news-recent-title">
      <h2 id="news-recent-title" className="news-month-title">
        Recent news
      </h2>
      <ul className="news-items">
        {recent.map((p) => (
          <li key={p.id}>
            <Link className="news-recent-item" to={`/news/${p.slug}`}>
              <span className="news-recent-title">{p.title}</span>
              <time className="news-recent-date" dateTime={postDate(p)}>
                {newsShortDate(postDate(p))}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
