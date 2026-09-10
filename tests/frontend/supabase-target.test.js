import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// Which Supabase the page talks to (#1052). Until now both entry points carried
// the production URL and key as literals, so the site could only ever be looked
// at against production, and a PR touching a migration and a page could not be
// rehearsed as one thing.
//
// The rule is the hostname and nothing else: no query key, no storage flag, no
// port test, because each of those is a way for a page served from the real
// domain to be talked into pointing somewhere else.
//
// The case that matters most here is the one with no hostname at all. Forty-
// eight suites in this directory stub `location` as `{ search, pathname }`, so
// if absent ever stopped meaning production, every one of them would quietly
// start exercising a local client against a stack that is not running.

const PROD_URL = 'https://kxgjqnpwfklbgrxdgmmv.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';

function target(hostname) {
  const sandbox = loadCommonJs(quietConsole, hostname === undefined ? {} : { location: { hostname } });
  return { url: sandbox.SUPABASE_URL, key: sandbox.SUPABASE_ANON_KEY };
}

describe('the Supabase target follows the hostname (#1052)', () => {
  it('resolves the local stack on localhost', () => {
    expect(target('localhost').url).toBe(LOCAL_URL);
  });

  it('resolves the local stack on 127.0.0.1', () => {
    // Both spellings, because the browser suite serves on 127.0.0.1 while the
    // runbook opens localhost (Twitch's embed rejects the numeric parent).
    expect(target('127.0.0.1').url).toBe(LOCAL_URL);
  });

  it('uses the documented local key on the local stack, not the production one', () => {
    const { key } = target('localhost');
    expect(key.startsWith('eyJ')).toBe(true);
    expect(key.startsWith('sb_publishable_')).toBe(false);
  });

  it('resolves production on the deployed hostname, with the publishable key', () => {
    const { url, key } = target('katogaming88.github.io');
    expect(url).toBe(PROD_URL);
    expect(key.startsWith('sb_publishable_')).toBe(true);
  });

  it('resolves production when there is no hostname at all', () => {
    // The vm sandboxes. This is the assertion that keeps the other suites
    // honest, so it is worth more than the three above.
    const { url, key } = target(undefined);
    expect(url).toBe(PROD_URL);
    expect(key.startsWith('sb_publishable_')).toBe(true);
  });

  it('resolves production for a hostname that merely contains localhost', () => {
    // A substring test would send a page on localhost.example.com to a stack
    // that is not theirs. Exact match, both spellings.
    expect(target('localhost.example.com').url).toBe(PROD_URL);
    expect(target('mylocalhost').url).toBe(PROD_URL);
  });
});
