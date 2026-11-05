// When a batched RSVP change posts (#1710): the pure half of the drain's
// decision. Raid: 2026-11-04 at 9 PM Eastern.
import { assertEquals } from 'jsr:@std/assert@1';
import { buildRsvpDigest, dueAt } from '../../../supabase/functions/discord-bot-webhook/rsvp-batch.ts';

const RAID = new Date('2026-11-05T02:00:00Z');
const DATE = '2026-11-04';
const at = (s: string) => new Date(s);

Deno.test('as it happens posts at the moment it was made', () => {
  const made = at('2026-11-01T05:00:00Z');
  assertEquals(dueAt(null, made, RAID, DATE), made);
});

Deno.test('before each raid: the hours before the start, or at once when that has passed', () => {
  const timing = { when: 'before_raid', hours: 3 } as const;
  assertEquals(dueAt(timing, at('2026-11-01T05:00:00Z'), RAID, DATE), at('2026-11-04T23:00:00Z'));
  const late = at('2026-11-04T23:30:00Z');
  assertEquals(dueAt(timing, late, RAID, DATE), late);
});

Deno.test('daily: the next time of day after the change, in the team zone, across the clock change', () => {
  const timing = { when: 'daily', time: '09:00', timezone: 'America/New_York' } as const;
  // 1 AM Eastern on 1 November, still daylight time: 9 AM is 14:00Z once the clocks go back.
  assertEquals(dueAt(timing, at('2026-11-01T05:00:00Z'), RAID, DATE), at('2026-11-01T14:00:00Z'));
  // After 9 AM it is tomorrow's 9 AM.
  assertEquals(dueAt(timing, at('2026-11-01T15:00:00Z'), RAID, DATE), at('2026-11-02T14:00:00Z'));
});

Deno.test('a raid that starts before the next batched post posts at once', () => {
  const timing = { when: 'daily', time: '09:00', timezone: 'America/New_York' } as const;
  const made = at('2026-11-04T20:00:00Z');
  assertEquals(dueAt(timing, made, RAID, DATE), made);
});

Deno.test('a night with no start time: the batch on earlier days, at once on the day itself', () => {
  const daily = { when: 'daily', time: '09:00', timezone: 'America/New_York' } as const;
  // Two days ahead: the next morning's post comes first.
  assertEquals(dueAt(daily, at('2026-11-02T20:00:00Z'), null, DATE), at('2026-11-03T14:00:00Z'));
  // The evening before: the next post is the raid's own morning, so at once.
  const eve = at('2026-11-03T20:00:00Z');
  assertEquals(dueAt(daily, eve, null, DATE), eve);
  // The day itself.
  const day = at('2026-11-04T20:00:00Z');
  assertEquals(dueAt(daily, day, null, DATE), day);
  // Before each raid has nothing to count back from.
  const made = at('2026-11-01T05:00:00Z');
  assertEquals(dueAt({ when: 'before_raid', hours: 3 }, made, null, DATE), made);
});

// Discord refuses a whole message over these, on every try.
const size = (embed: { title: string; fields?: { name: string; value: string }[]; footer?: { text: string } }) =>
  embed.title.length +
  (embed.footer?.text.length ?? 0) +
  (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

Deno.test("the fullest claim, 25 long notes on different nights, stays inside Discord's limits", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    charName: 'Katorri-Stormrage' + i,
    raidDate: `2026-12-${String(i + 1).padStart(2, '0')}`,
    status: 'Leaving Early',
    note: 'x'.repeat(2000)
  }));
  const embed = buildRsvpDigest(rows, null).embeds[0];
  assertEquals(embed.fields!.length, 25);
  assertEquals(size(embed) <= 6000, true);
});

Deno.test('a night too long for one field carries on in another, and nobody is cut', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    charName: 'Raider' + i,
    raidDate: DATE,
    status: 'Late',
    note: 'y'.repeat(100)
  }));
  const fields = buildRsvpDigest(rows, null).embeds[0].fields!;
  assertEquals(fields.length > 1, true);
  assertEquals(fields[0].name, DATE);
  assertEquals(fields[1].name, DATE + ' (continued)');
  for (const f of fields) assertEquals(f.value.length <= 1024, true);
  const all = fields.map((f) => f.value).join('\n');
  for (let i = 0; i < 25; i++) assertEquals(all.includes(`Raider${i}: Late`), true);
});

Deno.test('a typed @everyone in a note pings nobody', () => {
  const message = buildRsvpDigest([{ charName: 'Mira', raidDate: DATE, status: 'Late', note: '@everyone' }], null);
  assertEquals(message.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('two long names sharing their start are two raiders', () => {
  const long = 'z'.repeat(70);
  const message = buildRsvpDigest(
    [
      { charName: long + 'a', raidDate: DATE, status: 'Late' },
      { charName: long + 'b', raidDate: DATE, status: 'Absent' }
    ],
    null
  );
  assertEquals(message.embeds[0].fields![0].value.split('\n').length, 2);
});
