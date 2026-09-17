import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NewsEntry } from './news';

// news.json is a static file beside the app (the build copies it from the repo
// root), not a Supabase read: nobody writes it at runtime.
export function useNews() {
  return useQuery({
    queryKey: ['news'],
    queryFn: async (): Promise<NewsEntry[]> => {
      const res = await fetch(`${import.meta.env.BASE_URL}news.json`);
      if (!res.ok) throw new Error(`news.json answered ${res.status}`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as NewsEntry[]) : [];
    },
    staleTime: 5 * 60_000
  });
}

// The newest entry the reader has seen, in this browser. The same key as the
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

export function useNewsSeen(): [string | null, (version: string) => void] {
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const markSeen = useCallback((version: string) => {
    try {
      localStorage.setItem(SEEN_KEY, version);
    } catch {
      // Not remembered; the mark comes back next visit.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, []);
  return [seen, markSeen];
}
