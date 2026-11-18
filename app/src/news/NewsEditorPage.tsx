import { useId, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useSupabase } from '../data/DataProvider';
import { errorMessage } from '../lib/errors';
import { Markdown } from '../lib/markdown';
import { PostNotFound } from './NewsPostPage';
import * as formatting from './formatting';
import { NEWS_CATEGORIES, uniqueSlug, type NewsPost } from './news';
import { newsPictureUrl, uploadNewsPicture, useNews, useSaveNewsPost } from './useNews';
import './news.css';

// Writing a post, for Staff (#1230): /news/new and /news/<address>/edit. The
// body is simple formatting with a live preview: the buttons type the
// formatting for you, and the preview beside it shows the post as it will
// read. The database refuses anyone but Staff on its own; the route only
// decides who is shown the page.
export function NewsEditorPage() {
  const { slug } = useParams();
  const news = useNews();
  return (
    <DataState query={news} label="the post">
      {(posts) => {
        if (slug === undefined) return <PostEditor posts={posts} post={null} />;
        const post = posts.find((p) => p.slug === slug);
        return post ? <PostEditor key={post.id} posts={posts} post={post} /> : <PostNotFound />;
      }}
    </DataState>
  );
}

const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

function PostEditor({ posts, post }: { posts: NewsPost[]; post: NewsPost | null }) {
  const client = useSupabase();
  const navigate = useNavigate();
  const { announce } = useStatus();
  const save = useSaveNewsPost();
  const ids = { title: useId(), category: useId(), summary: useId(), caption: useId(), body: useId() };

  const [title, setTitle] = useState(post?.title ?? '');
  const [category, setCategory] = useState(post?.category ?? 'Feature');
  const [summary, setSummary] = useState(post?.summary ?? '');
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [coverPath, setCoverPath] = useState(post?.coverPath ?? null);
  const [coverCaption, setCoverCaption] = useState(post?.coverCaption ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [tried, setTried] = useState(false);
  const [uploading, setUploading] = useState(false);

  const bodyBox = useRef<HTMLTextAreaElement>(null);
  const bodyPicker = useRef<HTMLInputElement>(null);
  const coverPicker = useRef<HTMLInputElement>(null);
  // Where the formatting button's result leaves the cursor, applied once the
  // new text is in the box; and where the cursor was when the picture button
  // was pressed, since the file dialog takes the focus away.
  const nextSelection = useRef<[number, number] | null>(null);
  const pictureAt = useRef<[number, number]>([0, 0]);

  useLayoutEffect(() => {
    const at = nextSelection.current;
    if (at && bodyBox.current) {
      bodyBox.current.focus();
      bodyBox.current.setSelectionRange(at[0], at[1]);
      nextSelection.current = null;
    }
  }, [body]);

  const selection = (): [number, number] => {
    const box = bodyBox.current;
    return [box?.selectionStart ?? body.length, box?.selectionEnd ?? body.length];
  };
  const apply = (edit: formatting.Edit) => {
    nextSelection.current = [edit.start, edit.end];
    setBody(edit.text);
  };
  const format = (fn: (text: string, start: number, end: number) => formatting.Edit) => {
    const [start, end] = selection();
    apply(fn(body, start, end));
  };

  const upload = async (file: File): Promise<string | null> => {
    setUploading(true);
    try {
      return await uploadNewsPicture(client, file);
    } catch (error) {
      announce('error', errorMessage(error));
      return null;
    } finally {
      setUploading(false);
    }
  };
  const chosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    return file;
  };
  const onCover = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = chosen(e);
    const path = file ? await upload(file) : null;
    if (path) setCoverPath(path);
  };
  const onBodyPicture = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = chosen(e);
    const path = file ? await upload(file) : null;
    if (!file || !path) return;
    const alt = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    const [start, end] = pictureAt.current;
    apply(
      formatting.picture(
        body,
        Math.min(start, body.length),
        Math.min(end, body.length),
        newsPictureUrl(client, path),
        alt
      )
    );
  };

  const published = post?.publishedAt != null;
  const missingTitle = tried && !title.trim();
  const missingSummary = tried && !summary.trim();

  // `publish` sets the date a new post goes out; a post that already has a
  // date (out, or set for later) keeps it.
  const submit = (publish: boolean) => {
    setTried(true);
    if (!title.trim() || !summary.trim()) return;
    const slug = post?.slug ?? uniqueSlug(title, new Set(posts.map((p) => p.slug)));
    save.mutate(
      {
        id: post?.id ?? null,
        slug,
        input: {
          title: title.trim(),
          category,
          summary: summary.trim(),
          body,
          coverPath,
          coverCaption: coverPath && coverCaption.trim() ? coverCaption.trim() : null,
          pinned
        },
        publishedAt: post?.publishedAt ?? (publish ? new Date().toISOString() : null)
      },
      {
        onSuccess: (saved) => {
          announce('success', published ? 'Changes saved.' : publish ? 'Post published.' : 'Draft saved.');
          void navigate(`/news/${saved}`);
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );
  };
  const busy = save.isPending || uploading;

  return (
    <section className="page news-editor" aria-labelledby="page-title">
      <Link to={post ? `/news/${post.slug}` : '/news'}>{post ? 'Back to the post' : 'All news'}</Link>
      <h1 id="page-title">{post ? 'Edit post' : 'New post'}</h1>
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="news-editor-row">
          <div className="field news-editor-title">
            <label className="field-label" htmlFor={ids.title}>
              Title
            </label>
            <input
              id={ids.title}
              className="input"
              type="text"
              value={title}
              aria-invalid={missingTitle}
              onChange={(e) => setTitle(e.target.value)}
            />
            {missingTitle && <p className="form-error">Give the post a title.</p>}
          </div>
          <div className="field news-editor-category">
            <label className="field-label" htmlFor={ids.category}>
              Category
            </label>
            <select id={ids.category} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {NEWS_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.summary}>
            Summary, shown in the list
          </label>
          <input
            id={ids.summary}
            className="input"
            type="text"
            value={summary}
            aria-invalid={missingSummary}
            onChange={(e) => setSummary(e.target.value)}
          />
          {missingSummary && <p className="form-error">Add a one-line summary for the list.</p>}
        </div>

        <div className="news-editor-options">
          <label className="checkbox">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to the top of News
          </label>
          <div className="news-editor-cover">
            <input
              ref={coverPicker}
              hidden
              type="file"
              name="cover"
              accept={PICTURE_TYPES}
              onChange={(e) => void onCover(e)}
            />
            <button type="button" className="button" disabled={uploading} onClick={() => coverPicker.current?.click()}>
              {coverPath ? 'Replace the cover picture' : 'Add a cover picture'}
            </button>
            {coverPath && (
              <button type="button" className="button" onClick={() => setCoverPath(null)}>
                Remove it
              </button>
            )}
          </div>
        </div>
        {coverPath && (
          <div className="news-editor-cover-row">
            <img className="news-editor-thumb" src={newsPictureUrl(client, coverPath)} alt="Cover" />
            <div className="field">
              <label className="field-label" htmlFor={ids.caption}>
                Cover caption (optional)
              </label>
              <input
                id={ids.caption}
                className="input"
                type="text"
                value={coverCaption}
                onChange={(e) => setCoverCaption(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="news-editor-columns">
          <div className="news-editor-write">
            <div className="news-editor-write-head">
              <label className="field-label" htmlFor={ids.body}>
                Post
              </label>
              <div role="toolbar" aria-label="Formatting" className="news-toolbar">
                <button type="button" className="button" onClick={() => format(formatting.heading)}>
                  Heading
                </button>
                <button type="button" className="button news-tool-bold" onClick={() => format(formatting.bold)}>
                  Bold
                </button>
                <button type="button" className="button" onClick={() => format(formatting.list)}>
                  List
                </button>
                <button type="button" className="button" onClick={() => format(formatting.link)}>
                  Link
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={uploading}
                  onClick={() => {
                    pictureAt.current = selection();
                    bodyPicker.current?.click();
                  }}
                >
                  Picture
                </button>
                <input
                  ref={bodyPicker}
                  hidden
                  type="file"
                  name="picture"
                  accept={PICTURE_TYPES}
                  onChange={(e) => void onBodyPicture(e)}
                />
              </div>
            </div>
            <textarea
              id={ids.body}
              ref={bodyBox}
              className="textarea news-body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="field-hint">
              ## starts a heading, - starts a list item, **two stars** make bold. The buttons type these for you.
            </p>
          </div>
          <div className="news-editor-preview">
            <h2 className="field-label">Preview</h2>
            <div className="news-body news-preview">
              {body.trim() ? (
                <Markdown text={body} pictures headingLevel={2} />
              ) : (
                <p className="text-dim">Nothing to preview yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="news-editor-actions">
          <Link className="button" to={post ? `/news/${post.slug}` : '/news'}>
            Cancel
          </Link>
          {published ? (
            <button type="button" className="button button-primary" disabled={busy} onClick={() => submit(true)}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => submit(false)}>
                Save draft
              </button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => submit(true)}>
                {save.isPending ? 'Saving…' : 'Publish'}
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
