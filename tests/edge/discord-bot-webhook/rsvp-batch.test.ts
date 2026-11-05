// When a batched RSVP change posts (#1710): the pure half of the drain's
// decision. Raid: 2026-11-04 at 9 PM Eastern.
import { assertEquals } from 'jsr:@std/assert@1';
import { dueAt } from '../../../supabase/functions/discord-bot-webhook/rsvp-batch.ts';

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
