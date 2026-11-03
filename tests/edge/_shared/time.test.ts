// _shared/time.ts (#960): a raid's wall-clock start in its own zone, either
// side of a daylight saving change, and the clock and weekday helpers the
// signup sheet leans on.
import { assertEquals } from 'jsr:@std/assert@1';
import { clockTime, weekdayOf, zonedTimeToUtc } from '../../../supabase/functions/_shared/time.ts';

const NY = 'America/New_York';

Deno.test('9 PM Eastern in summer and in winter', () => {
  assertEquals(zonedTimeToUtc('2026-07-07', '21:00:00', NY).toISOString(), '2026-07-08T01:00:00.000Z');
  assertEquals(zonedTimeToUtc('2026-11-03', '21:00:00', NY).toISOString(), '2026-11-04T02:00:00.000Z');
});

Deno.test('on the days the clocks change, both ways', () => {
  // Spring forward, 2026-03-08: the evening is already on daylight time.
  assertEquals(zonedTimeToUtc('2026-03-08', '21:00:00', NY).toISOString(), '2026-03-09T01:00:00.000Z');
  // Fall back, 2026-11-01: the evening is already on standard time.
  assertEquals(zonedTimeToUtc('2026-11-01', '21:00:00', NY).toISOString(), '2026-11-02T02:00:00.000Z');
});

Deno.test('another zone, and a time with no seconds', () => {
  assertEquals(zonedTimeToUtc('2026-11-03', '20:30', 'Europe/Berlin').toISOString(), '2026-11-03T19:30:00.000Z');
});

Deno.test('clockTime reads the wall clock as Postgres prints a time, midnight as 00', () => {
  assertEquals(clockTime(new Date('2026-11-04T02:00:00Z'), NY), '21:00:00');
  assertEquals(clockTime(new Date('2026-11-04T05:00:00Z'), NY), '00:00:00');
});

Deno.test('weekdayOf counts from Sunday, as raid_schedule does', () => {
  assertEquals(weekdayOf('2026-11-01'), 0);
  assertEquals(weekdayOf('2026-11-03'), 2);
  assertEquals(weekdayOf('2026-11-07'), 6);
});
