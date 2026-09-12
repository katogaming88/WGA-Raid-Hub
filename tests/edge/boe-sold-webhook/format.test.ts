// The sold post's pure decisions (#1006). Every expected string here was
// produced by running the pre-split index.ts's own lines over these rows,
// so the split is measured against the bundle that was deployed, not
// against a reading of it.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  closing,
  finderText,
  gold,
  itemLine,
  joinNames,
  moneyLines,
  oneLine,
  soldPost
} from '../../../supabase/functions/boe-sold-webhook/format.ts';
import { FINDER_ID, MANAGER_ID, SECOND_MANAGER_ID, SOLD_ROW } from '../_support/corpus.ts';

const PAYOUT_LINE =
  'Please get in touch with your raid leaders or <@200000000000000002> in the 15 minutes before raid starts to receive your gold.';

const RESOLVED_CONTENT =
  '## BoE Sold\n' +
  '<@100000000000000001>\n' +
  '\n' +
  '**Item:** Hero - __Voidglass Cloak__ 2/6\n' +
  '**Sale Price:** 52,800g\n' +
  '**Auction House Fee:** 2,640g\n' +
  '**Guild Bank:** 30,160g\n' +
  "**Finder's Cut:** 20,000g\n" +
  '\n' +
  PAYOUT_LINE;

Deno.test('gold rounds to whole gold with thousands separators', () => {
  assertEquals(gold(52800), '52800g');
  assertEquals(gold(2639.6), '2,640g');
  assertEquals(gold('52800.4'), '52,800g');
});

Deno.test('gold reads a non-numeric or missing value as zero', () => {
  assertEquals(gold('x'), '0g');
  assertEquals(gold(null), '0g');
  assertEquals(gold(undefined), '0g');
});

Deno.test('oneLine collapses runs of whitespace, newlines included, and trims', () => {
  assertEquals(oneLine('  Void\nglass  Cloak '), 'Void glass Cloak');
  assertEquals(oneLine('Ae\tryn'), 'Ae ryn');
  assertEquals(oneLine(null), '');
});

Deno.test('joinNames reads as a sentence for zero, one, two and three names', () => {
  assertEquals(joinNames([]), '');
  assertEquals(joinNames(['A']), 'A');
  assertEquals(joinNames(['A', 'B']), 'A or B');
  assertEquals(joinNames(['A', 'B', 'C']), 'A, B or C');
});

Deno.test('itemLine puts the track before the underlined name and the rank after it', () => {
  assertEquals(itemLine(SOLD_ROW), '**Item:** Hero - __Voidglass Cloak__ 2/6');
});

Deno.test('itemLine drops the track and rank when the row has none, and names an unknown item', () => {
  assertEquals(itemLine({ track: null, item_name: '', upgrade_rank: '' }), '**Item:** __Unknown item__');
});

Deno.test('itemLine collapses a newline inside the item name', () => {
  assertEquals(
    itemLine({ track: 'Hero', item_name: '  Void\nglass  Cloak ', upgrade_rank: '2/6' }),
    '**Item:** Hero - __Void glass Cloak__ 2/6'
  );
});

Deno.test('finderText mentions a resolved finder and bolds the name of an unresolved one', () => {
  assertEquals(finderText(FINDER_ID, 'Aeryn'), '<@100000000000000001>');
  assertEquals(finderText(null, 'Aeryn'), '**Aeryn**');
  assertEquals(finderText(null, 'Ae\tryn'), '**Ae ryn**');
  assertEquals(finderText(null, ''), '**Unknown finder**');
});

Deno.test('moneyLines are the four labelled figures in the order that adds up', () => {
  assertEquals(moneyLines(SOLD_ROW), [
    '**Sale Price:** 52,800g',
    '**Auction House Fee:** 2,640g',
    '**Guild Bank:** 30,160g',
    "**Finder's Cut:** 20,000g"
  ]);
});

Deno.test('moneyLines render a bad or missing figure as zero rather than failing the post', () => {
  assertEquals(moneyLines({ sale_price: '52800.4', ah_fee: 'x', guild_cut: null, finder_payout: 2639.6 }), [
    '**Sale Price:** 52,800g',
    '**Auction House Fee:** 0g',
    '**Guild Bank:** 0g',
    "**Finder's Cut:** 2,640g"
  ]);
});

Deno.test('closing sends a paid finder to the raid leaders or the manager, by mention', () => {
  assertEquals(closing(false, [MANAGER_ID]), PAYOUT_LINE);
});

Deno.test('closing thanks a finder who donated their cut', () => {
  assertEquals(closing(true, [MANAGER_ID]), 'Thanks for giving your cut to the guild bank.');
});

Deno.test('closing names the role when no manager holds a Discord id', () => {
  assertEquals(
    closing(false, []),
    'Please get in touch with your raid leaders or a BoE manager in the 15 minutes before raid starts to receive your gold.'
  );
});

Deno.test('closing joins two managers with or', () => {
  assertEquals(
    closing(false, [MANAGER_ID, SECOND_MANAGER_ID]),
    'Please get in touch with your raid leaders or <@200000000000000002> or <@200000000000000003> in the 15 minutes before raid starts to receive your gold.'
  );
});

Deno.test('soldPost is the pinned body: one username, the content, and only the finder allowed to ping', () => {
  assertEquals(soldPost(SOLD_ROW, FINDER_ID, [MANAGER_ID]), {
    username: 'BoE Sales',
    content: RESOLVED_CONTENT,
    allowed_mentions: { parse: [], users: ['100000000000000001'] }
  });
});

Deno.test('soldPost with no resolved finder bolds the name and allows nobody to ping', () => {
  const post = soldPost(SOLD_ROW, null, [MANAGER_ID]);
  assertEquals(post.content, RESOLVED_CONTENT.replace('<@100000000000000001>', '**Aeryn**'));
  assertEquals(post.allowed_mentions, { parse: [], users: [] });
});

Deno.test('soldPost on a donated row keeps the four figures and swaps the closing', () => {
  const post = soldPost({ ...SOLD_ROW, payout_donated: true }, FINDER_ID, [MANAGER_ID]);
  assertEquals(post.content, RESOLVED_CONTENT.replace(PAYOUT_LINE, 'Thanks for giving your cut to the guild bank.'));
});

// 292 characters of the resolved post are not the item name, so a name of
// 1,708 lands exactly on Discord's limit and one more character crosses it.
Deno.test('soldPost leaves a content of exactly 2000 characters alone', () => {
  const post = soldPost({ ...SOLD_ROW, item_name: 'V'.repeat(1708) }, FINDER_ID, [MANAGER_ID]);
  assertEquals(post.content.length, 2000);
  assertEquals(post.content.endsWith('to receive your gold.'), true);
});

Deno.test('soldPost clamps a longer content to 1997 characters and an ellipsis', () => {
  const full = RESOLVED_CONTENT.replace('Voidglass Cloak', 'V'.repeat(1709));
  const post = soldPost({ ...SOLD_ROW, item_name: 'V'.repeat(1709) }, FINDER_ID, [MANAGER_ID]);
  assertEquals(full.length, 2001);
  assertEquals(post.content, full.slice(0, 1997) + '...');
  assertEquals(post.content.length, 2000);
});
