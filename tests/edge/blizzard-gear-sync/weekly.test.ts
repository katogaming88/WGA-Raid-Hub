// The roster audit's weekly row (#1636): the week turns over at the US reset,
// each part is written only when its own read worked, and crests and delves
// come out of the statistics by id.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  mplusFrom,
  raidKillsFrom,
  statsFrom,
  syncWeek,
  weekOf,
  weekStartMs,
  type ProfileAnswer
} from '../../../supabase/functions/blizzard-gear-sync/weekly.ts';

const CRESTS = new Map([
  [62915, 'Hero'],
  [62916, 'Myth']
]);

// Tue 2026-11-10 15:00 UTC is a reset.
const NOW = new Date('2026-11-12T12:00:00Z');
const SINCE = Date.parse('2026-11-10T15:00:00Z');

function fakeDb(error: string | null = null) {
  const upserts: Array<{ row: any; opts: any }> = [];
  const client = {
    from(table: string) {
      assertEquals(table, 'character_weeks');
      return {
        upsert(row: any, opts: any) {
          upserts.push({ row, opts });
          return Promise.resolve({ error: error ? { message: error } : null });
        }
      };
    }
  };
  return { db: client as any, upserts };
}

function reader(answers: Record<string, ProfileAnswer | Error>) {
  return (endpoint: string) => {
    const a = answers[endpoint];
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a ?? { status: 404, data: null });
  };
}

const MPLUS = {
  current_mythic_rating: { rating: 2534.26 },
  current_period: {
    best_runs: [
      { dungeon: { id: 503 }, keystone_level: 10, is_completed_within_time: false, completed_timestamp: SINCE + 1000 },
      { dungeon: { id: 505 }, keystone_level: 12, is_completed_within_time: true, completed_timestamp: SINCE + 2000 },
      { dungeon: { id: 507 }, keystone_level: 15, is_completed_within_time: true, completed_timestamp: SINCE - 1 }
    ]
  }
};

const RAIDS = {
  expansions: [
    {
      instances: [
        {
          instance: { id: 1320 },
          modes: [
            {
              difficulty: { type: 'HEROIC' },
              progress: {
                encounters: [
                  { encounter: { id: 3176 }, last_kill_timestamp: SINCE + 5 },
                  { encounter: { id: 3177 }, last_kill_timestamp: SINCE - 5 }
                ]
              }
            },
            {
              difficulty: { type: 'MYTHIC' },
              progress: { encounters: [{ encounter: { id: 3176 }, last_kill_timestamp: SINCE }] }
            }
          ]
        }
      ]
    }
  ]
};

const STATS = {
  categories: [
    {
      statistics: [{ id: 40734, quantity: 61 }],
      sub_categories: [
        {
          statistics: [
            { id: 40773, quantity: 40 },
            { id: 40776, quantity: 12 },
            { id: 40766, quantity: 0 },
            { id: 62916, quantity: 750 }
          ]
        }
      ]
    }
  ]
};

Deno.test('the week turns over at the US reset, Tuesday 15:00 UTC', () => {
  assertEquals(weekOf(new Date('2026-11-10T14:59:59Z')), '2026-11-03');
  assertEquals(weekOf(new Date('2026-11-10T15:00:00Z')), '2026-11-10');
  assertEquals(weekOf(new Date('2026-11-16T23:00:00Z')), '2026-11-10');
  assertEquals(weekOf(new Date('2026-11-17T15:00:00Z')), '2026-11-17');
  assertEquals(weekStartMs('2026-11-10'), SINCE);
});

Deno.test('M+: only runs since the reset, highest key first, rating to one place', () => {
  assertEquals(mplusFrom(MPLUS, SINCE), {
    runs: [
      { dungeon_id: 505, level: 12, timed: true },
      { dungeon_id: 503, level: 10, timed: false }
    ],
    rating: 2534.3
  });
  assertEquals(mplusFrom({}, SINCE), { runs: [], rating: null });
});

Deno.test('raid kills: each boss, its raid and difficulty killed since the reset', () => {
  assertEquals(raidKillsFrom(RAIDS, SINCE), [
    { encounter_id: 3176, instance_id: 1320, difficulty: 'heroic' },
    { encounter_id: 3176, instance_id: 1320, difficulty: 'mythic' }
  ]);
});

Deno.test('statistics: crests by the season ids (0 when absent), delves by tier', () => {
  assertEquals(statsFrom(STATS, CRESTS), { crests: { Hero: 0, Myth: 750 }, delves: { '8': 40, '11': 12 } });
});

Deno.test('every read working writes every part, with its time, into this week', async () => {
  const { db, upserts } = fakeDb();
  const result = await syncWeek(
    reader({
      summary: { status: 200, data: { equipped_item_level: 721.4 } },
      'mythic-keystone-profile': { status: 200, data: MPLUS },
      'encounters/raids': { status: 200, data: RAIDS },
      'achievements/statistics': { status: 200, data: STATS }
    }),
    db,
    'Katorri-Stormrage',
    CRESTS,
    NOW
  );
  assertEquals(result, { refused: [], saveError: null });
  assertEquals(upserts.length, 1);
  const { row, opts } = upserts[0];
  assertEquals(opts, { onConflict: 'name_realm_key,week_of' });
  assertEquals(row.week_of, '2026-11-10');
  assertEquals(row.name_realm, 'Katorri-Stormrage');
  for (const k of ['mplus_at', 'raids_at', 'crests_at', 'delves_at']) assertEquals(row[k], NOW.toISOString());
  assertEquals(row.crests, { Hero: 0, Myth: 750 });
  // The equipped level is saved; the highest ever is the database's to keep.
  assertEquals(row.item_level, 721);
  assertEquals('best_item_level' in row, false);
});

Deno.test('a summary with no usable item level leaves it out of the write', async () => {
  const { db, upserts } = fakeDb();
  await syncWeek(
    reader({
      summary: { status: 200, data: { equipped_item_level: 0 } },
      'encounters/raids': { status: 200, data: RAIDS }
    }),
    db,
    'Katorri-Stormrage',
    CRESTS,
    NOW
  );
  assertEquals('item_level' in upserts[0].row, false);
});

Deno.test('a failed read leaves that part out of the write and records the refusal', async () => {
  const { db, upserts } = fakeDb();
  const result = await syncWeek(
    reader({
      'mythic-keystone-profile': { status: 429, data: null },
      'encounters/raids': new Error('network down'),
      'achievements/statistics': { status: 200, data: STATS }
    }),
    db,
    'Katorri-Stormrage',
    CRESTS,
    NOW
  );
  assertEquals(result.refused, [
    { endpoint: 'mythic-keystone-profile', status: 429 },
    { endpoint: 'encounters/raids', status: 0 }
  ]);
  const row = upserts[0].row;
  for (const k of ['mplus_runs', 'mplus_rating', 'mplus_at', 'raid_kills', 'raids_at']) {
    assertEquals(k in row, false, k + ' must not be written');
  }
  assertEquals(row.delves, { '8': 40, '11': 12 });
});

Deno.test('every read failing writes nothing; a 404 is a plain skip', async () => {
  const { db, upserts } = fakeDb();
  const result = await syncWeek(reader({}), db, 'Gone-Stormrage', CRESTS, NOW);
  assertEquals(result, { refused: [], saveError: null });
  assertEquals(upserts.length, 0);
});

Deno.test('a failed save is returned', async () => {
  const { db } = fakeDb('boom');
  const result = await syncWeek(
    reader({ 'encounters/raids': { status: 200, data: RAIDS } }),
    db,
    'Katorri-Stormrage',
    CRESTS,
    NOW
  );
  assertEquals(result.saveError, 'boom');
});
