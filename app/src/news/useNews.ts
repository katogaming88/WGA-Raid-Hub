import { useCallback, useState, useSyncExternalStore } from 'react';
import { useSession } from '../auth/session';
import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { NewsPost } from './news';

// News posts are rows of news_posts (#1523): everyone reads the ones that are
// out, Staff also read drafts and posts dated later, and the database refuses
// any write from anyone else. The reads are cached with the signed-in person,
// so signing in brings Staff their drafts.
const COLUMNS = 'id, slug, title, category, summary, body, cover_path, cover_caption, version, pinned, published_at';

export function useNews() {
  const { user } = useSession();
  return useSupabaseQuery<NewsPost[]>(['news', user?.id ?? null], async (client) => {
    const { data, error } = await client
      .from('news_posts')
      .select(COLUMNS)
      .order('published_at', { ascending: false, nullsFirst: true });
    if (error) return { data: null, error };
    return {
      data: (data ?? []).map((row): NewsPost => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        category: row.category,
        summary: row.summary,
        body: row.body,
        coverPath: row.cover_path,
        coverCaption: row.cover_caption,
        version: row.version,
        pinned: row.pinned,
        publishedAt: row.published_at
      })),
      error: null
    };
  });
}

// The moment a page judges which posts are out by: fixed when the page opens,
// so a render never reads the clock.
export const useNow = (): number => useState(() => Date.now())[0];

export type NewsPostInput = {
  title: string;
  category: string;
  summary: string;
  body: string;
  coverPath: string | null;
  coverCaption: string | null;
  pinned: boolean;
};

// Adds a post (id null) at `slug`, or saves one's edits: its address and who
// wrote it never change. `publishedAt` null saves a draft. Resolves to the
// post's address.
export function useSaveNewsPost() {
  return useSupabaseMutation<
    string,
    { id: number | null; slug: string; input: NewsPostInput; publishedAt: string | null }
  >(
    async (client, { id, slug, input, publishedAt }) => {
      const values = {
        title: input.title,
        category: input.category,
        summary: input.summary,
        body: input.body,
        cover_path: input.coverPath,
        cover_caption: input.coverCaption,
        pinned: input.pinned,
        published_at: publishedAt
      };
      // written_by is left out of an add: the database signs it as the caller.
      const result =
        id === null
          ? await client.from('news_posts').insert({ slug, ...values })
          : await client.from('news_posts').update(values).eq('id', id);
      return { data: slug, error: result.error };
    },
    { key: ['save-news-post'], refreshes: [['news']] }
  );
}

// `onDeleted` runs once the list has been read again, and runs even though the
// post's own page has gone by then (a callback passed to mutate() would not).
export function useDeleteNewsPost(onDeleted: () => void) {
  return useSupabaseMutation<null, number>(
    async (client, id) => {
      const result = await client.from('news_posts').delete().eq('id', id);
      return { data: null, error: result.error };
    },
    { key: ['delete-news-post'], refreshes: [['news']], onSuccess: onDeleted }
  );
}

// The pictures bucket takes png, jpg, webp and gif up to 5 MB, which Storage
// itself enforces. A picture is never replaced in place: a new upload is a new
// file, and one no post uses any more stays in the bucket.
const PICTURE_BUCKET = 'news-pictures';

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PICTURE_MAX_BYTES = 5 * 1024 * 1024;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// What is wrong with a file before it is sent, said plainly, or null.
export function pictureProblem(file: File): string | null {
  const name = `“${file.name}”`;
  if (!PICTURE_TYPES.includes(file.type)) {
    const kind = file.type ? ` (${file.type.replace(/^.*\//, '').toUpperCase()})` : '';
    return `${name} didn’t upload: it isn’t a picture type the site takes${kind}. Use a PNG, JPG, WebP or GIF.`;
  }
  if (file.size > PICTURE_MAX_BYTES) {
    return `${name} didn’t upload: it is ${megabytes(file.size)}, and pictures can be up to 5 MB. Shrink it and try again.`;
  }
  return null;
}

// Why Storage refused a file, in plain words, from what it answered.
export function uploadProblem(error: { message: string }, file: File): string {
  const name = `“${file.name}”`;
  const said = error.message;
  if (/exceed|too large|maximum allowed size|payload/i.test(said)) {
    return `${name} didn’t upload: it is ${megabytes(file.size)}, and pictures can be up to 5 MB. Shrink it and try again.`;
  }
  if (/mime|not supported|invalid.*type/i.test(said)) {
    return `${name} didn’t upload: the server only takes a PNG, JPG, WebP or GIF.`;
  }
  if (/row-level security|unauthori[sz]ed|not authori[sz]ed|jwt|permission/i.test(said)) {
    return `${name} didn’t upload: only Staff can add pictures, and this sign-in isn’t Staff or has expired. Sign in again and retry.`;
  }
  if (/failed to fetch|network|timed? ?out|load failed/i.test(said)) {
    return `${name} didn’t upload: the connection to the server dropped. Check your connection and try again.`;
  }
  return `${name} didn’t upload. The server said: “${said}”.`;
}

export async function uploadNewsPicture(client: Client, file: File): Promise<string> {
  const problem = pictureProblem(file);
  if (problem) throw new Error(problem);
  const ext = /\.(png|jpe?g|gif|webp)$/i.exec(file.name)?.[1]?.toLowerCase() ?? 'png';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from(PICTURE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(uploadProblem(error, file));
  return path;
}

export const newsPictureUrl = (client: Client, path: string): string =>
  client.storage.from(PICTURE_BUCKET).getPublicUrl(path).data.publicUrl;

// The newest post the reader has seen, in this browser. The same key as the
// current site, so the mark carries over at cutover.
export const SEEN_KEY = 'wga_news_last_seen';
const SEEN_EVENT = 'wga-news-seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(SEEN_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SEEN_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useNewsSeen(): [string | null, (mark: string) => void] {
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const markSeen = useCallback((mark: string) => {
    try {
      localStorage.setItem(SEEN_KEY, mark);
    } catch {
      // Not remembered; the mark comes back next visit.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, []);
  return [seen, markSeen];
}
