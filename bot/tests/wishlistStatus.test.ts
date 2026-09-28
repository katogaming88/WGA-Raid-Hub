import { describe, it, expect } from 'vitest';
import { profileDeepLink, nudgeCandidatesFromRows, nudgeLines, WishlistSetupStatusRow } from '../src/wishlistStatus';

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

// wishlist_setup_status() answers one row per raider per tier they can edit
// (WGA-Raid-Hub#1268). The bot still sends each raider one DM, and names the
// tier only once the team's rows span more than one, so a team on one tier
// reads exactly as it did.
const row = (over: Partial<WishlistSetupStatusRow> = {}): WishlistSetupStatusRow => ({
  player_id: 1,
  name_realm: 'Aeryn-Illidan',
  discord_id: 'discord-1',
  wishlist_count: 16,
  bis_link: 'https://example.test/bis',
  missing_bis_rows: [],
  season: 'MID2',
  season_name: 'Midnight Season 2',
  ...over
});
const MID3 = { season: 'MID3', season_name: 'Midnight Season 3' };

describe('nudgeCandidatesFromRows', () => {
  it('gives one candidate per raider, with one tier per row', () => {
    const candidates = nudgeCandidatesFromRows([
      row({ missing_bis_rows: ['Head'] }),
      row({ ...MID3, wishlist_count: 0, missing_bis_rows: ['Head', 'Neck'] })
    ]);
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c.tiers.map((t) => [t.season, t.categories])).toEqual([
      ['MID2', ['incomplete-wishlist']],
      ['MID3', ['no-wishlist']]
    ]);
    expect(c.categories).toEqual(['no-wishlist', 'incomplete-wishlist']);
  });

  it('raises a missing BiS link once, whatever the tiers', () => {
    const [c] = nudgeCandidatesFromRows([row({ bis_link: null }), row({ ...MID3, bis_link: null })]);
    expect(c.categories).toEqual(['no-bis-link']);
  });

  it('leaves out a raider with nothing to fix', () => {
    const candidates = nudgeCandidatesFromRows([
      row(),
      row({ player_id: 2, discord_id: 'discord-2', missing_bis_rows: ['Head'] })
    ]);
    expect(candidates.map((c) => c.playerId)).toEqual([2]);
  });

  // A raider on the live tier alone, on a team that also opened the next one,
  // still has the next tier's raiders in the same run.
  it("names the tiers for every raider once the team's rows span two", () => {
    const candidates = nudgeCandidatesFromRows([
      row({ missing_bis_rows: ['Head'] }),
      row({ player_id: 2, discord_id: 'discord-2', ...MID3, wishlist_count: 0 })
    ]);
    expect(candidates.map((c) => c.nameTiers)).toEqual([true, true]);
    expect(nudgeCandidatesFromRows([row({ missing_bis_rows: ['Head'] })])[0].nameTiers).toBe(false);
  });
});

describe('nudgeLines', () => {
  it('reads as it did on a team with one tier', () => {
    const [c] = nudgeCandidatesFromRows([row({ bis_link: null, missing_bis_rows: ['Head', 'Neck'] })]);
    expect(nudgeLines(c, c.categories)).toEqual([
      "- You haven't submitted a BiS source link yet.",
      '- Your wishlist is missing a real BiS pick for one or more slots. Missing: **Head, Neck**'
    ]);
    const [empty] = nudgeCandidatesFromRows([row({ wishlist_count: 0, missing_bis_rows: ['Head'] })]);
    expect(nudgeLines(empty, empty.categories)).toEqual(["- You haven't submitted a wishlist yet."]);
  });

  it('names each tier once the team spans two', () => {
    const [c] = nudgeCandidatesFromRows([
      row({ missing_bis_rows: ['Head'] }),
      row({ ...MID3, wishlist_count: 0, missing_bis_rows: ['Head', 'Neck'] })
    ]);
    expect(nudgeLines(c, c.categories)).toEqual([
      "- You haven't submitted a wishlist for Midnight Season 3 yet.",
      '- Your Midnight Season 2 wishlist is missing a real BiS pick for one or more slots. Missing: **Head**'
    ]);
  });

  it('writes only the categories that are due', () => {
    const [c] = nudgeCandidatesFromRows([row({ bis_link: null, missing_bis_rows: ['Head'] })]);
    expect(nudgeLines(c, ['incomplete-wishlist'])).toEqual([
      '- Your wishlist is missing a real BiS pick for one or more slots. Missing: **Head**'
    ]);
  });
});
