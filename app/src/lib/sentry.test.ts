import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/browser';
import { reportError, setErrorReporter } from './errors';
import { initSentry, scrubBreadcrumb, scrubEvent, scrubUrl } from './sentry';

vi.mock('@sentry/browser', () => ({ init: vi.fn(), captureException: vi.fn(), setUser: vi.fn() }));

afterEach(() => {
  setErrorReporter(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Sentry reporting', () => {
  it('stays off without a DSN, so local development only logs', () => {
    expect(initSentry(undefined, 'localhost')).toBe(false);
    expect(initSentry('', 'localhost')).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('sends what reportError gets, and keeps the console line', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(initSentry('https://key@o0.ingest.sentry.io/1', 'preview')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'preview', sendDefaultPii: false })
    );
    reportError({ message: 'statement timeout' }, { where: 'query', key: ['streamers', [1, 2]] });
    const [sent, options] = vi.mocked(Sentry.captureException).mock.calls[0]!;
    expect(sent).toBeInstanceOf(Error);
    expect((sent as Error).message).toBe('statement timeout');
    expect(options).toEqual({ tags: { where: 'query', read: 'streamers' } });
    expect(log).toHaveBeenCalled();
  });
});

describe('what never leaves the browser', () => {
  it('drops the query and fragment from an address', () => {
    expect(scrubUrl('https://x.test/g/wga?code=abc#access_token=t')).toBe('https://x.test/g/wga');
  });

  it('strips headers, cookies and the query from an event', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://x.test/g/wga?code=abc',
        headers: { Referer: 'https://x.test/?code=abc' },
        cookies: { a: 'b' }
      }
    });
    expect(event.request).toEqual({ url: 'https://x.test/g/wga' });
  });

  it('cleans the addresses in a breadcrumb', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://api.test/rest/v1/players?email=eq.a@b.c' }
    });
    expect(crumb.data).toEqual({ url: 'https://api.test/rest/v1/players' });
  });
});
