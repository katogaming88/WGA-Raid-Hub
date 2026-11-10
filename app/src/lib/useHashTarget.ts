import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

// Scrolls a page section into view when the address names it (#1735: the old
// Invite link, Ranks and Signups addresses land on their section).
export function useHashTarget<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#' + id) ref.current?.scrollIntoView?.();
  }, [hash, id]);
  return ref;
}
