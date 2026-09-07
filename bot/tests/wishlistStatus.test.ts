import { describe, it, expect } from 'vitest';
import { profileDeepLink } from '../src/wishlistStatus';

// profileDeepLink is the one piece of the bot that is pure: no Discord client,
// no Supabase client and no environment. src/index.ts cannot be imported at
// all in a test, because it logs in and opens a port at module load.
describe('profileDeepLink', () => {
  const site = 'https://example.test';

  it('returns null when the raider has no category', () => {
    expect(profileDeepLink(site, 'Aeryn', [])).toBeNull();
  });

  it('sends both wishlist categories to the wishlist tab', () => {
    expect(profileDeepLink(site, 'Aeryn', ['no-wishlist'])).toBe('https://example.test/#profile/Aeryn/wishlist');
    expect(profileDeepLink(site, 'Aeryn', ['incomplete-wishlist'])).toBe(
      'https://example.test/#profile/Aeryn/wishlist'
    );
  });

  // Easy to get backwards, and the source comment says so: the fix for a
  // missing BiS link lives on the BiS tab, not the Wishlist one.
  it('sends no-bis-link to the bis tab', () => {
    expect(profileDeepLink(site, 'Aeryn', ['no-bis-link'])).toBe('https://example.test/#profile/Aeryn/bis');
  });

  it('follows the first category when a raider has several', () => {
    expect(profileDeepLink(site, 'Aeryn', ['no-bis-link', 'no-wishlist'])).toBe(
      'https://example.test/#profile/Aeryn/bis'
    );
  });

  it('strips one trailing slash from the site URL', () => {
    expect(profileDeepLink('https://example.test/', 'Aeryn', ['no-wishlist'])).toBe(
      'https://example.test/#profile/Aeryn/wishlist'
    );
  });

  it('encodes a name that needs it', () => {
    expect(profileDeepLink(site, 'Ae ryn', ['no-wishlist'])).toBe('https://example.test/#profile/Ae%20ryn/wishlist');
  });
});
