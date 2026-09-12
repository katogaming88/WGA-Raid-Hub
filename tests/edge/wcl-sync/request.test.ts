// wcl-sync's request body, parsed before the gate (#1013). Every refusal is
// the exact message the frontend shows, and the accepted shape is pinned
// field by field. The values that matter are the ones parseInt would have
// let through: '44abc' and '1) { name }' are 44 and 1 to parseInt.
import { assertEquals } from 'jsr:@std/assert@1';
import { type ParseResult, parseRequest, positiveInt } from '../../../supabase/functions/wcl-sync/request.ts';

function refused(error: string): ParseResult {
  return { ok: false, error };
}

Deno.test('positiveInt accepts a positive integer as a number or a digit string', () => {
  assertEquals(positiveInt(44), 44);
  assertEquals(positiveInt('44'), 44);
  assertEquals(positiveInt(44.0), 44);
  assertEquals(positiveInt(1000), 1000);
});

Deno.test('positiveInt rejects zero, negatives, fractions, padded and trailing text, and non-numbers', () => {
  for (const value of [0, -1, 1.5, Number.NaN, '007', '44abc', '1) { name }', '', null, undefined, true, [], {}]) {
    assertEquals(positiveInt(value), null, `positiveInt(${JSON.stringify(value)})`);
  }
});

Deno.test('a body that is not an object is missing its action and team', () => {
  assertEquals(parseRequest(null), refused('Missing action or teamId'));
  assertEquals(parseRequest(5), refused('Missing action or teamId'));
  assertEquals(parseRequest('x'), refused('Missing action or teamId'));
});

Deno.test('no action, no teamId, or a teamId of zero is the existing missing message', () => {
  assertEquals(parseRequest({}), refused('Missing action or teamId'));
  assertEquals(parseRequest({ action: 'getZoneEncounters' }), refused('Missing action or teamId'));
  assertEquals(parseRequest({ teamId: 1 }), refused('Missing action or teamId'));
  assertEquals(parseRequest({ action: 'getZoneEncounters', teamId: 0 }), refused('Missing action or teamId'));
});

Deno.test('a teamId that is present and not a positive integer is invalid', () => {
  assertEquals(parseRequest({ action: 'getZoneEncounters', teamId: '7a' }), refused('Invalid teamId'));
  assertEquals(parseRequest({ action: 'getZoneEncounters', teamId: 1.5 }), refused('Invalid teamId'));
});

Deno.test('an action outside the five is unknown, with the existing message', () => {
  assertEquals(parseRequest({ action: 'nope', teamId: 1 }), refused('Unknown action: nope'));
});

Deno.test('an action that needs a zone refuses an absent, blank or zero zoneId with the existing message', () => {
  assertEquals(parseRequest({ action: 'getZoneEncounters', teamId: 1 }), refused('Missing zoneId'));
  assertEquals(parseRequest({ action: 'fetchProgression', teamId: 1, zoneId: 0 }), refused('Missing zoneId'));
  assertEquals(parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: '' }), refused('Missing zoneId'));
});

Deno.test('a zoneId that is present and not a positive integer is invalid, whatever the action', () => {
  assertEquals(
    parseRequest({ action: 'getZoneEncounters', teamId: 1, zoneId: '1) { name }' }),
    refused('Invalid zoneId')
  );
  assertEquals(parseRequest({ action: 'getZoneEncounters', teamId: 1, zoneId: '44abc' }), refused('Invalid zoneId'));
  assertEquals(
    parseRequest({ action: 'refreshPerformance', teamId: 1, zoneId: '1) { name }' }),
    refused('Invalid zoneId')
  );
});

Deno.test('an action that needs no zone passes with zoneId null and season null', () => {
  assertEquals(parseRequest({ action: 'refreshPerformance', teamId: 1 }), {
    ok: true,
    request: { action: 'refreshPerformance', teamId: 1, zoneId: null, season: null }
  });
  assertEquals(parseRequest({ action: 'refreshAttendance', teamId: '7', zoneId: 0 }), {
    ok: true,
    request: { action: 'refreshAttendance', teamId: 7, zoneId: null, season: null }
  });
});

Deno.test('fetchSeasonPerf needs a season that is a non-empty string', () => {
  assertEquals(parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: 44 }), refused('Missing season'));
  assertEquals(
    parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: 44, season: '' }),
    refused('Missing season')
  );
  assertEquals(
    parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: 44, season: 5 }),
    refused('Missing season')
  );
  assertEquals(parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: '44', season: 'TWW3' }), {
    ok: true,
    request: { action: 'fetchSeasonPerf', teamId: 1, zoneId: 44, season: 'TWW3' }
  });
});

Deno.test('the checks run in a fixed order: team, then action, then zone, then season', () => {
  assertEquals(parseRequest({ action: 'nope', teamId: 'x' }), refused('Invalid teamId'));
  assertEquals(parseRequest({ action: 'nope', teamId: 1, zoneId: 'bad' }), refused('Unknown action: nope'));
  assertEquals(parseRequest({ action: 'fetchSeasonPerf', teamId: 1, zoneId: 'bad' }), refused('Invalid zoneId'));
});
