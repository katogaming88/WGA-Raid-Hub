// A tier's start date as the reports query's startTime (#1269): Eastern
// midnight, on either side of the clock changes. Moved from wcl-sync's tests
// when the progression sync took the same window (#1469).
import { assertEquals } from 'jsr:@std/assert@1';
import { tierStartTimeMs } from '../../../supabase/functions/_shared/tier-start.ts';

// Hours behind UTC that day, so the expected instants are computed here and
// never read back from the function.
const EDT = 4;
const EST = 5;

Deno.test('tierStartTimeMs: a summer date is Eastern midnight, four hours after UTC midnight', () => {
  assertEquals(tierStartTimeMs('2026-08-11'), Date.UTC(2026, 7, 11, EDT));
});

Deno.test('tierStartTimeMs: a winter date is five hours after', () => {
  assertEquals(tierStartTimeMs('2026-01-15'), Date.UTC(2026, 0, 15, EST));
});

Deno.test('tierStartTimeMs: the day the clocks go forward is still on winter time at midnight', () => {
  assertEquals(tierStartTimeMs('2026-03-08'), Date.UTC(2026, 2, 8, EST));
});

Deno.test('tierStartTimeMs: the day the clocks go back is still on summer time at midnight', () => {
  assertEquals(tierStartTimeMs('2026-11-01'), Date.UTC(2026, 10, 1, EDT));
});

Deno.test('tierStartTimeMs: no date, a malformed date and an unpadded date are null', () => {
  assertEquals(tierStartTimeMs(null), null);
  assertEquals(tierStartTimeMs('not a date'), null);
  assertEquals(tierStartTimeMs('2026-8-11'), null);
});
