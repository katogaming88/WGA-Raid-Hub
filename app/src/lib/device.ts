import { useSyncExternalStore } from 'react';

// Editing that needs a computer (Kat, 2026-09-14): on a phone or tablet a
// stray tap can mark the wrong thing, so a page can make its edits read-only
// there. Each page chooses whether it uses this; the wishlist editor is the
// first.
//
// A touch screen is judged by its main pointer, not the screen width, so a
// computer browser that is narrow or zoomed far in (as low vision users do)
// can still edit. A laptop with a touch screen keeps a mouse or trackpad as
// its main pointer and can edit too.
const TOUCH = '(pointer: coarse)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(TOUCH);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const onTouchScreen = () => window.matchMedia?.(TOUCH).matches ?? false;

export function useTouchScreen(): boolean {
  return useSyncExternalStore(subscribe, onTouchScreen, () => false);
}
