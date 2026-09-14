import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Files that opt into the node environment (tokens.test.ts) have no DOM.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  // jsdom has no matchMedia; with nothing matching, the theme falls back to dark.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false
      }) as MediaQueryList;
  }
}
