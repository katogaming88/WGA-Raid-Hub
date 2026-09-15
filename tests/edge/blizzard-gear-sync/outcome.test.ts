// The record a gear sweep leaves behind (#1174). The daily sweep wrote nothing
// for three mornings and no row said so: cron reported the queue, pg_net
// timed out before the answer, and synced_at moves on any write. These pin
// the outcome the function stores on site_settings after every run.
import { assertEquals } from 'jsr:@std/assert@1';
import { buildOutcome, newTally, noteError } from '../../../supabase/functions/blizzard-gear-sync/outcome.ts';

const STARTED = new Date('2026-09-15T10:07:03Z');
const FINISHED = new Date('2026-09-15T10:07:21Z');

Deno.test('a clean sweep over two teams records its counts, the trigger and both instants', () => {
  const tally = newTally();
  tally.teams = 2;
  tally.players = 57;
  tally.synced = 55;
  tally.skipped = 2;
  assertEquals(buildOutcome('cron', STARTED, FINISHED, tally), {
    trigger: 'cron',
    started_at: '2026-09-15T10:07:03.000Z',
    finished_at: '2026-09-15T10:07:21.000Z',
    synced: 55,
    skipped: 2,
    teams: 2,
    players: 57,
    error: null
  });
});

Deno.test('the first error is kept and later ones are ignored', () => {
  const tally = newTally();
  noteError(tally, 'Gateway Timeout');
  noteError(tally, 'a second failure');
  assertEquals(tally.error, 'Gateway Timeout');
});

Deno.test('an Error stores its message alone', () => {
  const tally = newTally();
  noteError(tally, new Error('upsert failed for player 12'));
  assertEquals(tally.error, 'upsert failed for player 12');
});

Deno.test('a message longer than 300 characters is cut to 300', () => {
  const tally = newTally();
  noteError(tally, 'x'.repeat(1000));
  assertEquals(tally.error?.length, 300);
});

Deno.test('a sweep that wrote nothing records synced 0 beside its error', () => {
  const tally = newTally();
  tally.teams = 3;
  tally.players = 55;
  tally.skipped = 55;
  noteError(tally, 'Gateway Timeout');
  const outcome = buildOutcome('cron', STARTED, FINISHED, tally);
  assertEquals(outcome.synced, 0);
  assertEquals(outcome.skipped, 55);
  assertEquals(outcome.error, 'Gateway Timeout');
});

Deno.test('an officer run records the officer trigger', () => {
  const tally = newTally();
  tally.teams = 1;
  tally.players = 1;
  tally.synced = 1;
  assertEquals(buildOutcome('officer', STARTED, FINISHED, tally).trigger, 'officer');
});
