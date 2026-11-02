// /nudge-missing's words (#998), moved from bot/tests/wishlistStatus.test.ts
// with the code: who is chased for what, the DM lines, and the profile link.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  type WishlistSetupStatusRow,
  nudgeCandidatesFromRows,
  nudgeEmbed,
  nudgeLines,
  profileDeepLink
} from '../../../supabase/functions/discord-interactions/nudge.ts';

const site = 'https://example.test';

Deno.test('profileDeepLink: null when the raider has no category', () => {
  assertEquals(profileDeepLink(site, 'Aeryn', []), null);
});

Deno.test('profileDeepLink: both wishlist categories go to the wishlist tab', () => {
  assertEquals(profileDeepLink(site, 'Aeryn', ['no-wishlist']), 'https://example.test/#profile/Aeryn/wishlist');
  assertEquals(profileDeepLink(site, 'Aeryn', ['incomplete-wishlist']), 'https://example.test/#profile/Aeryn/wishlist');
});

// The fix for a missing BiS link lives on the BiS tab, not the Wishlist one.
Deno.test('profileDeepLink: no-bis-link goes to the bis tab', () => {
  assertEquals(profileDeepLink(site, 'Aeryn', ['no-bis-link']), 'https://example.test/#profile/Aeryn/bis');
});

Deno.test('profileDeepLink: follows the first category when there are several', () => {
  assertEquals(
    profileDeepLink(site, 'Aeryn', ['no-bis-link', 'no-wishlist']),
    'https://example.test/#profile/Aeryn/bis'
  );
});

Deno.test('profileDeepLink: strips one trailing slash from the site URL', () => {
  assertEquals(
    profileDeepLink('https://example.test/', 'Aeryn', ['no-wishlist']),
    'https://example.test/#profile/Aeryn/wishlist'
  );
});

Deno.test('profileDeepLink: encodes a name that needs it', () => {
  assertEquals(profileDeepLink(site, 'Ae ryn', ['no-wishlist']), 'https://example.test/#profile/Ae%20ryn/wishlist');
});

// wishlist_setup_status() answers one row per raider per season they can
// edit (#1268). Each raider still gets one DM, and the season is named only
// once the team's rows span more than one.
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

Deno.test('candidates: one per raider, with one season per row', () => {
  const candidates = nudgeCandidatesFromRows([
    row({ missing_bis_rows: ['Head'] }),
    row({ ...MID3, wishlist_count: 0, missing_bis_rows: ['Head', 'Neck'] })
  ]);
  assertEquals(candidates.length, 1);
  assertEquals(
    candidates[0].seasons.map((s) => [s.season, s.categories]),
    [
      ['MID2', ['incomplete-wishlist']],
      ['MID3', ['no-wishlist']]
    ]
  );
  assertEquals(candidates[0].categories, ['no-wishlist', 'incomplete-wishlist']);
});

Deno.test('candidates: a missing BiS link is raised once, whatever the seasons', () => {
  const [c] = nudgeCandidatesFromRows([row({ bis_link: null }), row({ ...MID3, bis_link: null })]);
  assertEquals(c.categories, ['no-bis-link']);
});

Deno.test('candidates: a raider with nothing to fix is left out', () => {
  const candidates = nudgeCandidatesFromRows([
    row(),
    row({ player_id: 2, discord_id: 'discord-2', missing_bis_rows: ['Head'] })
  ]);
  assertEquals(
    candidates.map((c) => c.playerId),
    [2]
  );
});

Deno.test("candidates: seasons are named for every raider once the team's rows span two", () => {
  const candidates = nudgeCandidatesFromRows([
    row({ missing_bis_rows: ['Head'] }),
    row({ player_id: 2, discord_id: 'discord-2', ...MID3, wishlist_count: 0 })
  ]);
  assertEquals(
    candidates.map((c) => c.nameSeasons),
    [true, true]
  );
  assertEquals(nudgeCandidatesFromRows([row({ missing_bis_rows: ['Head'] })])[0].nameSeasons, false);
});

Deno.test('lines: read as they did on a team with one season', () => {
  const [c] = nudgeCandidatesFromRows([row({ bis_link: null, missing_bis_rows: ['Head', 'Neck'] })]);
  assertEquals(nudgeLines(c, c.categories), [
    "- You haven't submitted a BiS source link yet.",
    '- Your wishlist is missing a real BiS pick for one or more slots. Missing: **Head, Neck**'
  ]);
  const [empty] = nudgeCandidatesFromRows([row({ wishlist_count: 0, missing_bis_rows: ['Head'] })]);
  assertEquals(nudgeLines(empty, empty.categories), ["- You haven't submitted a wishlist yet."]);
});

Deno.test('lines: each season is named once the team spans two', () => {
  const [c] = nudgeCandidatesFromRows([
    row({ missing_bis_rows: ['Head'] }),
    row({ ...MID3, wishlist_count: 0, missing_bis_rows: ['Head', 'Neck'] })
  ]);
  assertEquals(nudgeLines(c, c.categories), [
    "- You haven't submitted a wishlist for Midnight Season 3 yet.",
    '- Your Midnight Season 2 wishlist is missing a real BiS pick for one or more slots. Missing: **Head**'
  ]);
});

Deno.test('lines: only the categories that are due', () => {
  const [c] = nudgeCandidatesFromRows([row({ bis_link: null, missing_bis_rows: ['Head'] })]);
  assertEquals(nudgeLines(c, ['incomplete-wishlist']), [
    '- Your wishlist is missing a real BiS pick for one or more slots. Missing: **Head**'
  ]);
});

Deno.test('embed: the link is there with SITE_URL and left out without it', () => {
  const [c] = nudgeCandidatesFromRows([row({ wishlist_count: 0 })]);
  assertEquals(nudgeEmbed('Phoenix', c, c.categories, site).fields, [
    { name: 'Update it here', value: 'https://example.test/#profile/Aeryn/wishlist' }
  ]);
  assertEquals(nudgeEmbed('Phoenix', c, c.categories).fields, undefined);
});
