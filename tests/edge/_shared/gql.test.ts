// The two GraphQL literal builders (#1013). A string comes back quoted with
// every character that could end the literal escaped; an int comes back as
// its digits or not at all. Expectations are the literal text, decided
// before the module exists.
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { gqlInt, gqlString } from '../../../supabase/functions/_shared/gql.ts';

Deno.test('gqlString wraps a plain report code in double quotes', () => {
  assertEquals(gqlString('AbC123xYz'), '"AbC123xYz"');
});

Deno.test('gqlString escapes a quote, a backslash and a newline', () => {
  assertEquals(gqlString('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
});

Deno.test('gqlString keeps a hostile code inside its literal', () => {
  assertEquals(gqlString('1") { name }'), '"1\\") { name }"');
});

Deno.test('gqlString of the empty string is an empty literal', () => {
  assertEquals(gqlString(''), '""');
});

Deno.test('gqlString throws on anything that is not a string', () => {
  assertThrows(() => gqlString(null as unknown as string), Error, 'GraphQL string expected');
  assertThrows(() => gqlString(44 as unknown as string), Error, 'GraphQL string expected');
});

Deno.test('gqlInt renders an integer as its digits', () => {
  assertEquals(gqlInt(44), '45');
  assertEquals(gqlInt(0), '0');
  assertEquals(gqlInt(1000), '1000');
});

Deno.test('gqlInt throws on a fraction, NaN, Infinity and a numeric string', () => {
  assertThrows(() => gqlInt(1.5), Error, 'GraphQL int expected');
  assertThrows(() => gqlInt(Number.NaN), Error, 'GraphQL int expected');
  assertThrows(() => gqlInt(Number.POSITIVE_INFINITY), Error, 'GraphQL int expected');
  assertThrows(() => gqlInt('44' as unknown as number), Error, 'GraphQL int expected');
});
