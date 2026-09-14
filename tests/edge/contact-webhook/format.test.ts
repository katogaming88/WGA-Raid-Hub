// The contact report's Discord post (#1129). A field value over 1024 has the
// whole post refused, and nothing stores a contact submission, so a long
// report used to be lost with "Discord responded with 400" as the only trace.
// These pin every field inside the budget and the rest of the post's shape.
import { assertEquals } from 'jsr:@std/assert@1';
import { contactPayload } from '../../../supabase/functions/contact-webhook/format.ts';

const NOW = new Date('2026-09-14T22:00:00Z');

const post = (over: Partial<Parameters<typeof contactPayload>[0]> = {}) =>
  contactPayload({ team: 'phoenix', name: 'Seed', message: 'hello', submitter: null, mark: null, now: NOW, ...over });

const field = (payload: ReturnType<typeof contactPayload>, name: string) =>
  payload.embeds[0].fields.find((f) => f.name === name)!.value;

Deno.test('a 5,000-character message posts a Message field of exactly 1024, ending in an ellipsis', () => {
  const value = field(post({ message: 'm'.repeat(5000) }), 'Message');
  assertEquals(value.length, 1024);
  assertEquals(value.endsWith('...'), true);
});

Deno.test('long team, name and message together leave no field over 1024, in order', () => {
  const payload = post({ team: 't'.repeat(5000), name: 'n'.repeat(5000), message: 'm'.repeat(5000) });
  const fields = payload.embeds[0].fields;
  assertEquals(
    fields.map((f) => f.name),
    ['Team', 'Name', 'Discord', 'Message']
  );
  assertEquals(
    fields.map((f) => f.value.length <= 1024),
    [true, true, true, true]
  );
});

Deno.test('a message of exactly 1024 is posted untouched', () => {
  const exact = 'm'.repeat(1024);
  assertEquals(field(post({ message: exact }), 'Message'), exact);
});

Deno.test('the Discord field is the mention, the username, or the signed-out note', () => {
  assertEquals(field(post({ submitter: { discordId: '123', username: 'Seed' } }), 'Discord'), '<@123>');
  assertEquals(field(post({ submitter: { discordId: null, username: 'Seed' } }), 'Discord'), 'Seed');
  assertEquals(field(post({ submitter: null }), 'Discord'), '(not logged in)');
});

Deno.test('a missing name and a missing team read as such', () => {
  const payload = post({ team: '', name: '' });
  assertEquals(field(payload, 'Team'), 'Unknown');
  assertEquals(field(payload, 'Name'), '(not provided)');
});

Deno.test('the marker rides as content on a local stack and the key is absent on production', () => {
  assertEquals(post({ mark: '[local]' }).content, '[local]');
  assertEquals('content' in post({ mark: null }), false);
});

Deno.test('nothing pings, and the timestamp is the given instant', () => {
  const payload = post();
  assertEquals(payload.allowed_mentions, { parse: [] });
  assertEquals(payload.embeds[0].timestamp, '2026-09-14T22:00:00.000Z');
});
