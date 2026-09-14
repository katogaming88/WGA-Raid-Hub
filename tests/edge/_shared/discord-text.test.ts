// The Discord text budget (#1129). truncate() is what keeps an embed field
// value inside the 1024 Discord accepts; the copy it replaces kept max - 1
// characters and then added three, so a cut value came out at max + 2 and the
// whole post was refused. Every case asserts the length the caller asked for,
// never the arithmetic.
import { assertEquals } from 'jsr:@std/assert@1';
import { EMBED_FIELD_VALUE_MAX, truncate } from '../../../supabase/functions/_shared/discord-text.ts';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

Deno.test('one over the budget comes back exactly the budget long, ending in the suffix', () => {
  const got = truncate('x'.repeat(1025), 1024);
  assertEquals(got.length, 1024);
  assertEquals(got.endsWith('...'), true);
});

Deno.test('far over the budget comes back exactly the budget long', () => {
  assertEquals(truncate('x'.repeat(5000), 1024).length, 1024);
});

Deno.test('exactly the budget is returned unchanged, and empty stays empty', () => {
  const exact = 'x'.repeat(1024);
  assertEquals(truncate(exact, 1024), exact);
  assertEquals(truncate('', 1024), '');
});

Deno.test('a suffix of another length is budgeted the same way', () => {
  assertEquals(truncate('abcdef', 4, '..'), 'ab..');
});

Deno.test('a budget shorter than the suffix cuts with no suffix', () => {
  assertEquals(truncate('abcdef', 2), 'ab');
});

Deno.test('a cut that would split an emoji backs off one unit and leaves no lone surrogate', () => {
  // 1020 letters then a two-unit emoji: the cut for a 1024 budget with a
  // three-character suffix (index 1021) lands between the emoji's two halves.
  const got = truncate('a'.repeat(1020) + '\u{1F600}' + 'b'.repeat(10), 1024);
  assertEquals(got.length <= 1024, true);
  assertEquals(got.endsWith('...'), true);
  assertEquals(LONE_SURROGATE.test(got), false);
});

Deno.test('the embed field budget is the 1024 Discord documents', () => {
  assertEquals(EMBED_FIELD_VALUE_MAX, 1024);
});
